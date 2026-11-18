// Spec: knowledge/components/adyen-agentic-commerce.md
// The Back Office's lists, paged and filtered in SQL: a page reads what it shows and no more. Every
// answer leaves through maskEmails, because the Back Office is public when the playground's basic
// auth is unset (as on Render).
import { agentState } from "../lib/agent-status";
import { maskEmail, maskEmails } from "../lib/mask";
import type { Order, PaymentRecord } from "./commerce";
import type { Customer } from "./customers";
import { count, database, findBy, get } from "./db";
import { type Grant, SCOPES } from "./oauth";
import type { TraceEntry } from "./trace";

export const PER_PAGE = [25, 50, 100] as const;
export type Per = (typeof PER_PAGE)[number];

export type Paged<T> = { items: T[]; page: number; per: number; total: number; pages: number };

export type LogFilters = {
  channel?: string;
  actor?: string;
  status?: "2xx" | "3xx" | "4xx" | "5xx";
  path?: string;
  ref?: string;
};

const first = (raw: unknown): string =>
  typeof raw === "string" ? raw : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : "";

// A positive integer, else 1; the last page is applied once the total is known.
export const pageParam = (raw: unknown): number => {
  const s = first(raw);
  return /^[1-9]\d{0,6}$/.test(s) ? Number(s) : 1;
};

export const perParam = (raw: unknown): Per => {
  const s = first(raw);
  return s === "50" ? 50 : s === "100" ? 100 : 25;
};

const text = (raw: unknown, max: number) => {
  const s = first(raw).trim();
  return s ? s.slice(0, max) : undefined;
};

export function logFilters(query: Record<string, unknown>): LogFilters {
  const channel = first(query.channel);
  const status = first(query.status);
  return {
    channel: /^[a-z]{1,20}$/.test(channel) ? channel : undefined,
    actor: text(query.actor, 100),
    status: /^[2-5]xx$/.test(status) ? (status as LogFilters["status"]) : undefined,
    path: text(query.path, 200),
    ref: text(query.ref, 100),
  };
}

function paged<T>(total: number, page: number, per: number, read: (n: number, o: number) => T[]) {
  const pages = Math.max(1, Math.ceil(total / per));
  const shown = Math.min(page, pages);
  return { items: read(per, (shown - 1) * per), page: shown, per, total, pages } as Paged<T>;
}

type Row = Record<string, unknown>;
const toEntry = (row: Row): TraceEntry => ({
  ...(row as TraceEntry),
  detail: JSON.parse(String(row.detail)),
});

function whereOf(f: LogFilters) {
  const parts: string[] = [];
  const params: Record<string, string | number> = {};
  if (f.channel) {
    parts.push("channel = $channel");
    params.channel = f.channel;
  }
  if (f.actor) {
    parts.push("actor = $actor");
    params.actor = f.actor;
  }
  if (f.status) {
    const lo = Number(f.status[0]) * 100;
    parts.push("status >= $lo and status < $hi");
    params.lo = lo;
    params.hi = lo + 100;
  }
  if (f.path) {
    // instr, not LIKE: a typed % or _ is a character to find, never a pattern.
    parts.push("instr(lower(path), lower($path)) > 0");
    params.path = f.path;
  }
  if (f.ref) {
    parts.push("ref = $ref");
    params.ref = f.ref;
  }
  return { sql: parts.length ? `where ${parts.join(" and ")}` : "", params };
}

export function tracePage(filters: LogFilters, page: number, per: number): Paged<TraceEntry> {
  const { sql, params } = whereOf(filters);
  const db = database();
  const total =
    db.query<{ n: number }, typeof params>(`select count(*) as n from trace ${sql}`).get(params)
      ?.n ?? 0;
  return maskEmails(
    paged(total, page, per, (n, o) =>
      db
        .query<Row, Record<string, string | number>>(
          `select * from trace ${sql} order by id desc limit $n offset $o`,
        )
        .all({ ...params, n, o })
        .map(toEntry),
    ),
  );
}

// The values the Log's selects offer, from what the trace holds.
export function logChoices() {
  const db = database();
  const column = (name: "channel" | "actor") =>
    db
      .query<{ v: string }, Record<string, never>>(
        `select distinct ${name} as v from trace order by v limit 50`,
      )
      .all({})
      .map((r) => r.v);
  return { channels: column("channel"), actors: maskEmails(column("actor")) };
}

function docsPage<T>(collection: "orders" | "payments" | "grants", page: number, per: number) {
  return paged(count(collection), page, per, (n, o) =>
    database()
      .query<{ data: string }, { c: string; n: number; o: number }>(
        "select data from docs where collection = $c order by created_at desc limit $n offset $o",
      )
      .all({ c: collection, n, o })
      .map((row) => JSON.parse(row.data) as T),
  );
}

export const ordersPage = (page: number) => maskEmails(docsPage<Order>("orders", page, 25));
export const paymentsPage = (page: number) =>
  maskEmails(docsPage<PaymentRecord>("payments", page, 25));

// Every grant: who it acts for, in words, and where its budget stands.
export function agentsPage(page: number) {
  const grants = docsPage<Grant>("grants", page, 25);
  return {
    ...grants,
    items: grants.items.map((g) => ({
      id: g.id,
      name: g.clientName,
      clientId: g.clientId,
      account: g.customerId
        ? maskEmail(get<Customer>("customers", g.customerId)?.email)
        : "no account",
      permissions: g.scopes.map((s) => SCOPES[s]?.short ?? "Unknown permission"),
      spendLimit: g.spendLimit,
      spent: g.spent,
      remaining: Math.max(g.spendLimit - g.spent, 0),
      state: agentState(g),
      lastUsedAt: g.lastUsedAt,
      createdAt: g.createdAt,
    })),
  };
}

// An order's story: the trace entries naming it, its checkout or its payments, oldest first.
export function orderTimeline(orderId: string) {
  const order = get<Order>("orders", orderId);
  if (!order) return undefined;
  const refs = [
    order.id,
    order.checkoutId,
    ...findBy<PaymentRecord>("payments", "checkoutId", order.checkoutId).map((p) => p.reference),
  ];
  const params = Object.fromEntries(refs.map((r, i) => [`r${i}`, r]));
  const marks = refs.map((_, i) => `$r${i}`).join(", ");
  const entries = database()
    .query<Row, Record<string, string>>(
      `select * from trace where ref in (${marks}) order by id asc limit 200`,
    )
    .all(params)
    .map(toEntry);
  return maskEmails({ order, entries });
}

export function overview() {
  const db = database();
  const results = db
    .query<{ r: string | null; n: number }, { c: string }>(
      "select json_extract(data, '$.resultCode') as r, count(*) as n from docs where collection = $c group by r",
    )
    .all({ c: "payments" });
  const resulted = (code: string) => results.find((r) => r.r === code)?.n ?? 0;
  const grants = db
    .query<{ data: string }, { c: string }>("select data from docs where collection = $c")
    .all({ c: "grants" })
    .map((row) => JSON.parse(row.data) as Grant);
  const active = grants.filter((g) => !g.revoked);
  const lastError = db
    .query<Row, Record<string, never>>(
      "select * from trace where status >= 500 order by id desc limit 1",
    )
    .get({});
  return maskEmails({
    orders: count("orders"),
    authorised: resulted("Authorised"),
    refused: resulted("Refused"),
    agents: active.length,
    connected: active.filter((g) => agentState(g) === "connected").length,
    webhooks: tracePage({ channel: "webhook" }, 1, 1).total,
    lastError: lastError ? toEntry(lastError) : undefined,
    latest: tracePage({}, 1, 10).items,
  });
}

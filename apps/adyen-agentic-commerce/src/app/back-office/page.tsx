// Spec: knowledge/components/adyen-agentic-commerce.md
import { LogList, stamp, statusTone } from "@/components/back-office/LogList";
import { Pager } from "@/components/back-office/Pager";
import { StatusPill } from "@/components/StatusPill";
import { money } from "@/lib/money";
import * as bo from "@/server/back-office";

export const metadata = { title: "Back Office" };
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

const TABS = [
  ["overview", "Overview"],
  ["orders", "Orders"],
  ["payments", "Payments"],
  ["agents", "Agents"],
  ["log", "Log"],
  ["webhooks", "Webhooks"],
] as const;
type Tab = (typeof TABS)[number][0];

// Links keep only the parameters that mean something on the target tab.
const link = (params: Record<string, string | number | undefined>) => {
  const kept = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return `/back-office?${new URLSearchParams(kept.map(([k, v]) => [k, String(v)]))}`;
};

const first = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

export default async function BackOffice({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const tab: Tab = TABS.find(([id]) => id === first(query.tab))?.[0] ?? "overview";
  const page = bo.pageParam(query.page);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl">Back Office</h1>
        <p className="text-sm text-muted">
          Orders, Adyen answers and every protocol exchange on this store. Tokens, card data and
          passwords are redacted, emails masked.
        </p>
      </div>
      <nav
        aria-label="Back Office"
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-2">
          {TABS.map(([id, label]) => (
            <li key={id}>
              <a
                href={link({ tab: id === "overview" ? undefined : id })}
                aria-current={tab === id ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
                  tab === id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-card hover:border-ink"
                }`}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "overview" ? <Overview /> : null}
      {tab === "orders" ? <Orders page={page} open={first(query.order)} /> : null}
      {tab === "payments" ? <Payments page={page} /> : null}
      {tab === "agents" ? <Agents page={page} /> : null}
      {tab === "log" ? <Log query={query} page={page} /> : null}
      {tab === "webhooks" ? <Webhooks page={page} /> : null}
    </div>
  );
}

const logHref = (ref: string) => link({ tab: "log", ref });

function Tile({
  label,
  value,
  note,
  href,
  tone = "",
}: {
  label: string;
  value: string;
  note?: string;
  href: string;
  tone?: string;
}) {
  return (
    <li>
      <a href={href} className="panel block h-full space-y-1 hover:border-ink">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <span className={`block truncate text-2xl tabular-nums ${tone}`}>{value}</span>
        {note ? <span className="block truncate text-xs text-muted">{note}</span> : null}
      </a>
    </li>
  );
}

function Overview() {
  const o = bo.overview();
  return (
    <div className="space-y-6">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Orders" value={String(o.orders)} href={link({ tab: "orders" })} />
        <Tile
          label="Authorised"
          value={String(o.authorised)}
          note="payments"
          href={link({ tab: "payments" })}
          tone="text-ok"
        />
        <Tile
          label="Refused"
          value={String(o.refused)}
          note="payments"
          href={link({ tab: "payments" })}
          tone={o.refused ? "text-warn" : ""}
        />
        <Tile
          label="Agents"
          value={String(o.agents)}
          note={`${o.connected} connected`}
          href={link({ tab: "agents" })}
        />
        <Tile label="Webhooks" value={String(o.webhooks)} href={link({ tab: "webhooks" })} />
        <Tile
          label="Last server error"
          value={o.lastError ? String(o.lastError.status) : "None"}
          note={o.lastError ? `${o.lastError.path}, ${stamp(o.lastError.at)}` : "no 5xx logged"}
          href={link({ tab: "log", status: "5xx" })}
          tone={o.lastError ? "text-bad" : "text-ok"}
        />
      </ul>
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl">Latest events</h2>
          <a href={link({ tab: "log" })} className="text-sm underline">
            Open the log
          </a>
        </div>
        <LogList entries={o.latest} refHref={logHref} />
      </section>
    </div>
  );
}

const ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 p-3 sm:px-4";

function Orders({ page, open }: { page: number; open?: string }) {
  const orders = bo.ordersPage(page);
  const timeline = open ? bo.orderTimeline(open) : undefined;
  return (
    <div className="space-y-4">
      {open && !timeline ? (
        <p role="alert" className="panel text-sm text-bad">
          No order {open}.
        </p>
      ) : null}
      {timeline ? (
        <section className="panel space-y-4" aria-labelledby="timeline-title">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="timeline-title" className="font-mono text-base">
              {timeline.order.id}
            </h2>
            <StatusPill status={timeline.order.status} />
            <span className="ml-auto font-medium tabular-nums">{money(timeline.order.total)}</span>
          </div>
          <p className="text-xs text-muted">
            {timeline.order.paidBy === "agent"
              ? `Paid by ${timeline.order.agentName ?? "an agent"}`
              : "Paid by the shopper"}
            {timeline.order.buyer?.email ? ` for ${timeline.order.buyer.email}` : ""}
            {timeline.order.pspReference ? `, PSP ${timeline.order.pspReference}` : ""}
            {timeline.order.webhook ? `, webhook ${timeline.order.webhook.eventCode}` : ""}.
          </p>
          {timeline.entries.length ? (
            <ol className="space-y-3 border-l-2 border-line pl-4">
              {timeline.entries.map((t) => (
                <li key={t.id} className="relative text-sm">
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full border-2 border-card bg-accent"
                  />
                  <span className="block text-xs text-muted tabular-nums">
                    {stamp(t.at)} · {t.channel} · {t.actor}
                  </span>
                  <span className="break-all font-mono text-xs">
                    {t.method} {t.path}{" "}
                    <span className={`font-sans font-medium ${statusTone(t.status)}`}>
                      {t.status}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No logged exchange names this order.</p>
          )}
          <a href={link({ tab: "orders", page })} className="text-sm underline">
            Close
          </a>
        </section>
      ) : null}
      {orders.items.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card text-sm">
          {orders.items.map((o) => (
            <li key={o.id} className={ROW}>
              <a
                href={link({ tab: "orders", page: orders.page, order: o.id })}
                className="font-mono text-xs underline"
              >
                {o.id}
              </a>
              <StatusPill status={o.status} />
              <span className="ml-auto font-medium tabular-nums">{money(o.total)}</span>
              <span className="w-full text-xs text-muted">
                {stamp(o.createdAt)} ·{" "}
                {o.paidBy === "agent"
                  ? `paid by ${o.agentName ?? "an agent"}`
                  : "paid by the shopper"}
                {o.webhook ? " · webhook received" : " · no webhook yet"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel text-sm text-muted">No order yet.</p>
      )}
      <Pager {...orders} noun="orders" href={(p) => link({ tab: "orders", page: p })} />
    </div>
  );
}

function Payments({ page }: { page: number }) {
  const payments = bo.paymentsPage(page);
  return (
    <div className="space-y-4">
      {payments.items.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card text-sm">
          {payments.items.map((p) => (
            <li key={p.id} className={ROW}>
              <a href={logHref(p.reference)} className="font-mono text-xs underline">
                {p.reference}
              </a>
              <StatusPill status={p.resultCode ?? "pending"} />
              <span className="ml-auto font-medium tabular-nums">{money(p.amount)}</span>
              <span className="w-full text-xs text-muted">
                {stamp(p.updatedAt)} ·{" "}
                {p.purpose === "card-save" ? "card save" : `${p.purpose} payment`}
                {p.agentName ? ` by ${p.agentName}` : ""}
                {p.instrument ? ` · ${p.instrument.replace("_", " ")}` : ""}
                {p.lastFour ? ` •••• ${p.lastFour}` : ""}
                {p.pspReference ? ` · PSP ${p.pspReference}` : ""}
                {p.refusalReason ? ` · ${p.refusalReason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel text-sm text-muted">No payment yet.</p>
      )}
      <Pager {...payments} noun="payments" href={(p) => link({ tab: "payments", page: p })} />
    </div>
  );
}

function Agents({ page }: { page: number }) {
  const agents = bo.agentsPage(page);
  return (
    <div className="space-y-4">
      {agents.items.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {agents.items.map((a) => (
            <li key={a.id} className="panel space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <strong className="min-w-0 flex-1 truncate font-medium">{a.name}</strong>
                <StatusPill status={a.state} />
              </div>
              <p className="text-xs text-muted">
                For {a.account}
                {a.lastUsedAt ? `, last request ${stamp(a.lastUsedAt)}` : ", no request yet"}
              </p>
              <p className="text-xs">
                <span className="font-medium tabular-nums">{money(a.remaining)} left</span>{" "}
                <span className="text-muted tabular-nums">
                  ({money(a.spent)} of {money(a.spendLimit)} spent)
                </span>
              </p>
              <p className="text-xs text-muted">{a.permissions.join(" · ")}</p>
              <p className="break-all text-xs text-muted">{a.clientId}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel text-sm text-muted">No agent has been approved yet.</p>
      )}
      <Pager {...agents} noun="agents" href={(p) => link({ tab: "agents", page: p })} />
    </div>
  );
}

function Log({ query, page }: { query: Query; page: number }) {
  const filters = bo.logFilters(query);
  const per = bo.perParam(query.per);
  const log = bo.tracePage(filters, page, per);
  const choices = bo.logChoices();
  const kept = { tab: "log", ...filters, per: per === 25 ? undefined : per };
  const select = "field min-h-11";
  return (
    <div className="space-y-4">
      <form
        method="get"
        action="/back-office"
        className="panel grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        <input type="hidden" name="tab" value="log" />
        <label className="space-y-1 text-xs font-medium text-muted">
          Channel
          <select name="channel" defaultValue={filters.channel ?? ""} className={select}>
            <option value="">All</option>
            {choices.channels.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Actor
          <select name="actor" defaultValue={filters.actor ?? ""} className={select}>
            <option value="">All</option>
            {choices.actors.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={select}>
            <option value="">All</option>
            {["2xx", "3xx", "4xx", "5xx"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Path contains
          <input
            name="path"
            defaultValue={filters.path ?? ""}
            placeholder="/mcp"
            className={select}
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Reference
          <input
            name="ref"
            defaultValue={filters.ref ?? ""}
            placeholder="ord_…"
            className={select}
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Per page
          <select name="per" defaultValue={String(per)} className={select}>
            {bo.PER_PAGE.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className="btn">
            Apply
          </button>
          <a href={link({ tab: "log" })} className="btn-ghost">
            Clear
          </a>
        </div>
      </form>
      <LogList entries={log.items} refHref={logHref} empty="Nothing matches these filters." />
      <Pager {...log} href={(p) => link({ ...kept, page: p })} />
    </div>
  );
}

function Webhooks({ page }: { page: number }) {
  const hooks = bo.tracePage({ channel: "webhook" }, page, 25);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Adyen's notifications, each checked against its HMAC signature: 200 is valid, 401 was
        rejected.
      </p>
      <LogList entries={hooks.items} refHref={logHref} empty="No webhook received yet." />
      <Pager {...hooks} noun="webhooks" href={(p) => link({ tab: "webhooks", page: p })} />
    </div>
  );
}

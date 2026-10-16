import { formatMinorAmount, prettyJson } from "@suite/ui/client.ts";
import { useCopy } from "@suite/ui/useCopy.ts";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { type Change, diff, onChangeSummary, plain } from "./onChangeDiff.ts";
import { asCurl } from "./curl.ts";
import { clip, field, text } from "./read.ts";

export interface TimelineEntry {
  id: string;
  kind: "api_call" | "frontend_callback" | "webhook" | "action" | "state";
  name: string;
  status: string;
  occurredAt: string;
  payload: unknown;
  durationMs?: number;
  hmacValid?: boolean;
  method?: string;
  endpoint?: string;
}

type Source = "sdk" | "api" | "webhook";

const SOURCES: Array<{ id: Source; label: string; tag: string }> = [
  { id: "sdk", label: "Adyen Web", tag: "SDK" },
  { id: "api", label: "API", tag: "API" },
  { id: "webhook", label: "Webhooks", tag: "Webhook" },
];

/**
 * Callbacks this playground used to record about itself: its own /sessions,
 * /payments, /paymentLinks and MIT responses, posted as if Adyen Web had
 * fired them. Each repeated an API call already in the list, so they are no
 * longer recorded (2026-10-10) and older rows are left out here.
 */
const PLAYGROUND_EVENTS = new Set([
  "sessionCreated",
  "backendPaymentResponse",
  "paymentLinkCreated",
  "mitResponse",
]);

/**
 * Only what Adyen produced: Adyen Web callbacks, Checkout API calls and
 * webhooks. Back Office action rows are the playground's own bookkeeping;
 * the Adyen call each one made is already an API row.
 */
function sourceOf(entry: TimelineEntry): Source | null {
  if (entry.kind === "api_call") return "api";
  if (entry.kind === "webhook") return "webhook";
  if (entry.kind === "frontend_callback" && !PLAYGROUND_EVENTS.has(entry.name)) return "sdk";
  return null;
}

type CallbackRank = "required" | "recommended" | "optional";

const CALLBACK_CATALOG: Record<string, { rank: CallbackRank; hint: string }> = {
  onSubmit: {
    rank: "required",
    hint: "You must call /payments with this state and resolve with its response.",
  },
  onAdditionalDetails: {
    rank: "required",
    hint: "3DS or redirect result: forward it to /payments/details, resolve with the response.",
  },
  onPaymentCompleted: {
    rank: "required",
    hint: "Terminal success. The resultCode is final, show the success page here.",
  },
  onPaymentFailed: {
    rank: "required",
    hint: "Terminal failure (refused, cancelled, expired). The order can still be retried.",
  },
  onBalanceCheck: {
    rank: "required",
    hint:
      "Advanced partial payments: check the gift card with /paymentMethods/balance and resolve with the response. Sessions does it for you.",
  },
  onOrderRequest: {
    rank: "required",
    hint:
      "Advanced partial payments: create the order via /orders and resolve with it. Sessions does it for you.",
  },
  onOrderUpdated: {
    rank: "required",
    hint:
      "Part of the order is paid. Show what is left and, with Components, mount the next method: it charges only the rest.",
  },
  onOrderCancel: {
    rank: "recommended",
    hint:
      "Advanced: the shopper removed a paid gift card in Drop-in. Cancel via /orders/cancel, resolve with the full amount.",
  },
  onPaymentMethodsRequest: {
    rank: "optional",
    hint:
      "Advanced: after a partial payment, /paymentMethods with the order lists what can pay the rest.",
  },
  onError: {
    rank: "recommended",
    hint: "Any Adyen Web error, including non-fatal wallet cancellations. Not a result.",
  },
  beforeSubmit: {
    rank: "optional",
    hint: "resolve() is not a plain continue: what you pass becomes the /payments payload.",
  },
  onChange: {
    rank: "optional",
    hint: "Fires on every field edit with the whole state. Diagnostics only, never a decision.",
  },
  onBinLookup: {
    rank: "optional",
    hint: "Co-badged networks detected from the first digits. Diagnostics only.",
  },
  onBinValue: { rank: "optional", hint: "Hashed BIN of the card being typed. Diagnostics only." },
  onBrand: {
    rank: "optional",
    hint: "Network detected inside the secured fields. Diagnostics only.",
  },
};

const API_HINTS: Array<[string, string]> = [
  [
    "/sessions",
    "One call; Adyen Web owns 3DS and the rest of the orchestration. The outcome comes from the AUTHORISATION webhook.",
  ],
  ["/paymentMethods/balance", "Gift card balance, before any money moves."],
  ["/paymentMethods", "Methods available for this amount, country and locale."],
  ["/payments/details", "Second leg of a 3DS or redirect flow."],
  ["/paymentLinks", "Creates or reads the Adyen-hosted payment page."],
  ["/orders/cancel", "Cancels the order; Adyen reverses what was paid into it."],
  ["/orders", "Partial payments: opens the order the gift card pays into."],
  ["lifecycle", "A modification; its outcome arrives as a webhook."],
  ["/payments", "Authorisation attempt for the submitted payment method."],
];

// ---------- One row per event ----------

interface Row {
  source: Source;
  title: string;
  status?: string;
  tone: "neutral" | "ok" | "error";
  summary: string[];
}

function apiPath(entry: TimelineEntry): string {
  if (entry.endpoint) {
    try {
      return new URL(entry.endpoint).pathname.replace(/^\/v\d+/, "");
    } catch {
      // Fall through to the name.
    }
  }
  return entry.name.replace(/^(MIT )?Checkout API\s*(GET|POST)?\s*/, "");
}

function apiMethod(entry: TimelineEntry): string {
  return entry.method ?? (/\bGET\b/.test(entry.name) ? "GET" : "POST");
}

function formatAmount(value: unknown): string | undefined {
  const minor = field(value, "value");
  const currency = text(field(value, "currency"));
  if (typeof minor !== "number" || !currency) return undefined;
  return formatMinorAmount(minor, currency);
}

function describe(entry: TimelineEntry, source: Source, changes: Change[] | null): Row {
  if (source === "api") {
    const api = entry.payload as { response?: unknown; error?: string };
    const code = Number(entry.status);
    const failed = Boolean(api?.error) || code >= 400;
    const outcome = text(field(api?.response, "resultCode")) ??
      text(field(api?.response, "status")) ?? (failed ? api?.error : undefined);
    return {
      source,
      title: `${apiMethod(entry)} ${apiPath(entry)}`,
      status: Number.isFinite(code) && code > 0 ? String(code) : undefined,
      tone: failed ? "error" : "ok",
      summary: [
        outcome ? clip(outcome, 40) : undefined,
        entry.durationMs !== undefined ? `${entry.durationMs} ms` : undefined,
      ].filter((part): part is string => Boolean(part)),
    };
  }
  if (source === "webhook") {
    const success = String(field(entry.payload, "success")) === "true";
    return {
      source,
      title: entry.name,
      status: entry.hmacValid ? "HMAC ✓" : "HMAC ✗",
      tone: entry.hmacValid && success ? "ok" : "error",
      summary: [
        success ? "success" : "failure",
        text(field(entry.payload, "pspReference")),
        formatAmount(field(entry.payload, "amount")),
      ].filter((part): part is string => Boolean(part)),
    };
  }
  const payload = entry.payload;
  let summary: string[];
  switch (entry.name) {
    case "onChange":
      summary = onChangeSummary(payload, changes);
      break;
    case "onSubmit":
    case "beforeSubmit":
      // onSubmit wraps the payment data in `data`; beforeSubmit gets it bare.
      summary = [
        text(field(payload, "data.paymentMethod.type") ?? field(payload, "paymentMethod.type")),
        text(field(payload, "data.paymentMethod.brand") ?? field(payload, "paymentMethod.brand")),
        field(payload, "isValid") === false ? "form incomplete" : undefined,
      ].filter((part): part is string => Boolean(part));
      break;
    case "onAdditionalDetails":
      summary = Object.keys(
        (field(payload, "data.details") ?? {}) as Record<string, unknown>,
      );
      break;
    case "onBinLookup":
      summary = [
        ...((field(payload, "detectedBrands") ?? field(payload, "supportedBrands") ??
          []) as string[]),
      ].map(String);
      break;
    default:
      summary = [
        text(field(payload, "resultCode")),
        text(field(payload, "brand")),
        text(field(payload, "binValue")),
        text(field(payload, "name")),
        text(field(payload, "message")),
      ].filter((part): part is string => Boolean(part)).map((part) => clip(part, 40));
  }
  const failed = entry.name === "onPaymentFailed" || entry.name === "onError";
  const done = entry.name === "onPaymentCompleted";
  return {
    source,
    title: entry.name,
    tone: failed ? "error" : done ? "ok" : "neutral",
    summary,
  };
}

// ---------- JSON with colours and folds ----------

const LONG_VALUE_LIMIT = 120;

interface Fold {
  key: string;
  expanded: boolean;
}

/**
 * Rewrites every string longer than LONG_VALUE_LIMIT to its first characters
 * plus a marker the renderer turns into an expander: one sdkData blob would
 * otherwise bury the fields around it.
 */
function foldLongValues(
  value: unknown,
  expandedValues: Set<string>,
  baseKey: string,
  folds: Fold[],
  path = "",
): unknown {
  if (typeof value === "string" && value.length > LONG_VALUE_LIMIT) {
    const key = `${baseKey}#${path}`;
    const expanded = expandedValues.has(key);
    folds.push({ key, expanded });
    const shown = expanded ? value : `${value.slice(0, LONG_VALUE_LIMIT)}…`;
    return `${shown}@@FOLD:${folds.length - 1}@@`;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      foldLongValues(entry, expandedValues, baseKey, folds, `${path}[${index}]`)
    );
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = foldLongValues(entry, expandedValues, baseKey, folds, `${path}.${key}`);
    }
    return output;
  }
  return value;
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function JsonBlock(props: { value: unknown; entryKey: string }) {
  const [expandedValues, setExpandedValues] = useState<Set<string>>(new Set());
  const folds: Fold[] = [];
  const rendered = prettyJson(foldLongValues(props.value, expandedValues, props.entryKey, folds)) ||
    "null";
  const toggle = (key: string) =>
    setExpandedValues((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const withFolds = (value: string): ComponentChildren[] =>
    value.split(/@@FOLD:(\d+)@@/).map((part, index) => {
      if (index % 2 === 0) return part;
      const fold = folds[Number(part)];
      if (!fold) return null;
      return (
        <button
          type="button"
          class="json__fold"
          key={fold.key}
          title={fold.expanded ? "Collapse this value" : "Show the full value"}
          onClick={() => toggle(fold.key)}
        >
          {fold.expanded ? "collapse" : "…"}
        </button>
      );
    });

  const nodes: ComponentChildren[] = [];
  let last = 0;
  for (const match of rendered.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(rendered.slice(last, index));
    if (match[1]) {
      nodes.push(
        <span class={match[2] ? "json__key" : "json__string"}>{withFolds(match[1])}</span>,
      );
      if (match[2]) nodes.push(match[2]);
    } else if (match[3]) {
      nodes.push(<span class={match[3] === "null" ? "json__null" : "json__bool"}>{match[3]}</span>);
    } else {
      nodes.push(<span class="json__number">{match[4]}</span>);
    }
    last = index + match[0].length;
  }
  nodes.push(rendered.slice(last));
  return <pre class="json">{nodes}</pre>;
}

// ---------- Detail ----------

function splitAdditionalData(value: unknown): { rest: unknown; additionalData: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { rest: value, additionalData: null };
  }
  const { additionalData, ...rest } = value as Record<string, unknown>;
  return { rest, additionalData: additionalData ?? null };
}

type Tab = "response" | "request" | "changes" | "payload";

function EntryDetail(props: { entry: TimelineEntry; source: Source; changes: Change[] | null }) {
  const { entry, source } = props;
  const api = source === "api"
    ? entry.payload as { request?: unknown; response?: unknown; error?: string }
    : null;
  // Request before response, in the order they happened; the response stays
  // the tab that opens, it is what the row summarises.
  const tabs: Tab[] = api
    ? ["request", "response"]
    : props.changes
    ? ["changes", "payload"]
    : ["payload"];
  const [tab, setTab] = useState<Tab>(api ? "response" : tabs[0]);
  // The two JSON blocks look alike; each direction gets its own colour and
  // header so the one on screen is never ambiguous.
  const failed = Boolean(api?.error) || Number(entry.status) >= 400;
  const toneOf = (value: Tab) =>
    value === "request" ? "request" : value === "response" ? (failed ? "error" : "response") : "";
  const direction = api && (tab === "request" || tab === "response") ? tab : null;
  const [showAdditional, setShowAdditional] = useState(false);
  const { copied, copy } = useCopy();

  const shown = api
    ? (tab === "request" ? api.request : api.error ? { error: api.error } : api.response)
    : entry.payload;
  const { rest, additionalData } = splitAdditionalData(shown);
  const json = prettyJson(shown);
  const curl = api && entry.endpoint ? asCurl(apiMethod(entry), entry.endpoint, api.request) : null;
  const meta = source === "sdk" ? CALLBACK_CATALOG[entry.name] : undefined;
  const hint = source === "sdk"
    ? meta?.hint ?? "Not in this playground's reference list; check the Adyen Web changelog."
    : source === "api"
    ? API_HINTS.find(([endpoint]) => entry.name.includes(endpoint))?.[1] ??
      "Adyen Checkout API call."
    : "Sent by Adyen to this server; the HMAC signature is checked before anything is processed.";

  return (
    <div class="ev__detail">
      {api
        ? (
          <p class="ev__endpoint">
            <span class="ev__verb">{apiMethod(entry)}</span>
            <span class="mono">{entry.endpoint ?? entry.name}</span>
          </p>
        )
        : null}
      <p class="ev__hint">
        {meta ? <span class={`ev__rank ev__rank--${meta.rank}`}>{meta.rank}</span> : null}
        {hint}
      </p>
      <div class="ev__toolbar">
        <div class="mini-tabs" role="tablist">
          {tabs.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              class={toneOf(value) ? `mini-tabs__tab--${toneOf(value)}` : undefined}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "changes"
                ? `Changes ${props.changes?.length ?? 0}`
                : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <span class="ev__actions">
          {curl
            ? (
              <button type="button" class="text-button" onClick={() => copy(curl, { raw: true })}>
                {copied === curl ? "Copied" : "Copy cURL"}
              </button>
            )
            : null}
          <button type="button" class="text-button" onClick={() => copy(json, { raw: true })}>
            {copied === json ? "Copied" : "Copy JSON"}
          </button>
        </span>
      </div>
      {tab === "changes"
        ? (
          props.changes?.length
            ? (
              <table class="changes">
                <tbody>
                  {props.changes.map((change) => (
                    <tr key={change.path}>
                      <th scope="row">{change.path}</th>
                      <td class="changes__before">{plain(change.before)}</td>
                      <td class="changes__after">{plain(change.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
            : <p class="ev__hint">Same state as the previous onChange.</p>
        )
        : (
          <>
            {direction
              ? (
                <div class={`ev__payload ev__payload--${toneOf(direction)}`}>
                  <p class="ev__direction">
                    <strong>{direction === "request" ? "Request" : "Response"}</strong>
                    <span>
                      {direction === "request"
                        ? "this server → Adyen"
                        : `Adyen → this server${
                          Number(entry.status) > 0 ? ` · HTTP ${entry.status}` : ""
                        }`}
                    </span>
                  </p>
                  <JsonBlock value={rest} entryKey={`${entry.id}:${tab}`} />
                </div>
              )
              : <JsonBlock value={rest} entryKey={`${entry.id}:${tab}`} />}
            {additionalData
              ? (
                <div class="ev__extra">
                  <button
                    type="button"
                    class="text-button"
                    aria-expanded={showAdditional}
                    onClick={() => setShowAdditional(!showAdditional)}
                  >
                    {showAdditional ? "Hide additionalData" : "Show additionalData"}
                  </button>
                  {showAdditional
                    ? <JsonBlock value={additionalData} entryKey={`${entry.id}:additional`} />
                    : null}
                </div>
              )
              : null}
          </>
        )}
    </div>
  );
}

// ---------- The list ----------

function relativeTime(milliseconds: number): string {
  if (milliseconds < 60_000) return `+${(milliseconds / 1000).toFixed(2)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `+${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleTimeString([], { hour12: false })}.${
    String(date.getMilliseconds()).padStart(3, "0")
  }`;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

interface Item {
  entry: TimelineEntry;
  source: Source;
  changes: Change[] | null;
  row: Row;
}

/**
 * Every event Adyen produced for a checkout, in order: Adyen Web callbacks,
 * the Checkout API calls this server made and the webhooks Adyen sent back.
 * Each onChange is its own row, summarised by what moved since the previous
 * one. Shared by the checkout's inspector and the Back Office.
 */
export function Timeline(props: { entries: TimelineEntry[]; empty: string }) {
  const [filter, setFilter] = useState<"all" | Source>("all");
  const [query, setQuery] = useState("");
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { copied, copy } = useCopy();

  const items: Item[] = [];
  let previousChange: unknown;
  for (const entry of props.entries) {
    const source = sourceOf(entry);
    if (!source) continue;
    let changes: Change[] | null = null;
    if (source === "sdk" && entry.name === "onChange") {
      changes = previousChange === undefined ? null : diff(previousChange, entry.payload);
      previousChange = entry.payload;
    }
    items.push({ entry, source, changes, row: describe(entry, source, changes) });
  }
  const live = clearedAt ? items.filter((item) => item.entry.occurredAt > clearedAt) : items;
  const hidden = items.length - live.length;
  const origin = live.length ? Date.parse(live[0].entry.occurredAt) : 0;
  const counts = new Map<Source, number>();
  for (const item of live) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  const needle = query.trim().toLowerCase();
  const visible = live.filter((item) =>
    (filter === "all" || item.source === filter) &&
    (!needle ||
      `${item.row.title} ${item.row.summary.join(" ")} ${JSON.stringify(item.entry.payload)}`
        .toLowerCase().includes(needle))
  );
  const exported = JSON.stringify(
    visible.map(({ entry, source }) => ({
      at: entry.occurredAt,
      source,
      name: entry.name,
      ...(entry.method ? { method: entry.method, endpoint: entry.endpoint } : {}),
      status: entry.status,
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      payload: entry.payload,
    })),
    null,
    2,
  );
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div class="timeline-view">
      <div class="tl-toolbar">
        <div class="tl-filters" role="tablist" aria-label="Filter events">
          {[{ id: "all" as const, label: "All" }, ...SOURCES].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              class="tl-filter"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span class="tl-filter__count">
                {item.id === "all" ? live.length : counts.get(item.id) ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div class="tl-tools">
          <input
            type="search"
            class="tl-search"
            placeholder="Search events and payloads"
            aria-label="Search events"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            type="button"
            class="tl-tool"
            disabled={!visible.length}
            onClick={() => copy(exported, { raw: true })}
          >
            {copied === exported ? "Copied" : "Copy all"}
          </button>
          <button
            type="button"
            class="tl-tool"
            disabled={!visible.length}
            onClick={() =>
              download(
                `adyen-events-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`,
                exported,
              )}
          >
            Export
          </button>
          <button
            type="button"
            class="tl-tool"
            disabled={!live.length}
            onClick={() => setClearedAt(new Date().toISOString())}
          >
            Clear
          </button>
        </div>
      </div>
      {hidden
        ? (
          <p class="tl-note">
            {hidden} earlier {hidden === 1 ? "event" : "events"} cleared.{" "}
            <button type="button" class="text-button" onClick={() => setClearedAt(null)}>
              Show them
            </button>
          </p>
        )
        : null}
      {visible.length
        ? (
          <ol class="tl-list">
            {visible.map(({ entry, source, changes, row }) => {
              const expanded = open.has(entry.id);
              const summary = row.summary.slice(0, 4);
              const more = row.summary.length - summary.length;
              return (
                <li class={`ev ev--${row.tone}${expanded ? " is-open" : ""}`} key={entry.id}>
                  <button
                    type="button"
                    class="ev__row"
                    aria-expanded={expanded}
                    onClick={() => toggle(entry.id)}
                  >
                    <span class={`ev__src ev__src--${source}`}>
                      {SOURCES.find((item) => item.id === source)?.tag}
                    </span>
                    <span class="ev__name">
                      {row.title}
                    </span>
                    {row.status
                      ? <span class={`ev__status ev__status--${row.tone}`}>{row.status}</span>
                      : null}
                    <time
                      class="ev__time"
                      datetime={entry.occurredAt}
                      title={clockTime(entry.occurredAt)}
                    >
                      {relativeTime(Date.parse(entry.occurredAt) - origin)}
                    </time>
                    {summary.length
                      ? (
                        <span class="ev__summary">
                          {summary.map((part, index) => (
                            <span class="ev__chip" key={`${part}-${index}`}>{part}</span>
                          ))}
                          {more > 0 ? <span class="ev__chip ev__chip--more">+{more}</span> : null}
                        </span>
                      )
                      : null}
                  </button>
                  {expanded
                    ? <EntryDetail entry={entry} source={source} changes={changes} />
                    : null}
                </li>
              );
            })}
          </ol>
        )
        : <p class="tl-empty">{live.length ? "No event matches." : props.empty}</p>}
    </div>
  );
}

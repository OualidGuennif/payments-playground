import { prettyJson } from "@suite/ui/client.ts";
import { useCopy } from "@suite/ui/useCopy.ts";
import { useState } from "preact/hooks";

export interface TimelineEntry {
  id: string;
  kind: "api_call" | "frontend_callback" | "webhook" | "action" | "state";
  name: string;
  status: string;
  occurredAt: string;
  payload: unknown;
  durationMs?: number;
  hmacValid?: boolean;
}

type CallbackRank = "required" | "recommended" | "optional" | "app";

interface CallbackMeta {
  rank: CallbackRank;
  hint: string;
}

/**
 * What each callback row actually is. `app` marks this playground's own
 * backend responses, so they are never mistaken for Adyen Web events.
 */
const CALLBACK_CATALOG: Record<string, CallbackMeta> = {
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
  onOrderRequest: {
    rank: "required",
    hint: "Partial payments: create the order via /orders and resolve with it.",
  },
  onOrderUpdated: {
    rank: "required",
    hint: "Partial payments: the remaining amount after each partial authorisation.",
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
    hint: "Fires on every field edit. Diagnostics only, never a payment decision.",
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
  sessionCreated: {
    rank: "app",
    hint: "Not an Adyen Web callback: the /sessions response from this playground.",
  },
  backendPaymentResponse: {
    rank: "app",
    hint: "Not an Adyen Web callback: this playground's /payments response, before resolve().",
  },
  paymentLinkCreated: {
    rank: "app",
    hint: "Not an Adyen Web callback: the /paymentLinks response from this playground.",
  },
  mitResponse: {
    rank: "app",
    hint: "Not an Adyen Web callback: the merchant-initiated /payments response.",
  },
};

const UNLISTED_CALLBACK: CallbackMeta = {
  rank: "optional",
  hint: "Not in this playground's reference list; check the Adyen Web changelog.",
};

const RANK_LABEL: Record<CallbackRank, string> = {
  required: "required",
  recommended: "recommended",
  optional: "optional",
  app: "playground",
};

// Callbacks that fire on every keystroke: shown once per run of repeats.
const CHATTY = new Set(["onChange", "onBinValue", "onBinLookup", "onBrand"]);

const API_HINTS: Array<[string, string]> = [
  ["GET /sessions", "The session's outcome, fetched with Adyen Web's sessionResult."],
  ["/sessions", "One call; Adyen Web owns 3DS and the rest of the orchestration."],
  ["/paymentMethods", "Methods available for this amount, country and locale."],
  ["/payments/details", "Second leg of a 3DS or redirect flow."],
  ["/paymentLinks", "Creates or reads the Adyen-hosted payment page."],
  ["/orders", "Partial payments: opens the order the gift card pays into."],
  ["lifecycle", "A modification; its outcome arrives as a webhook."],
  ["/payments", "Authorisation attempt for the submitted payment method."],
];

function callbackMeta(name: string): CallbackMeta {
  return CALLBACK_CATALOG[name] ?? UNLISTED_CALLBACK;
}

function apiHint(name: string): string {
  return API_HINTS.find(([endpoint]) => name.includes(endpoint))?.[1] ??
    "Adyen Checkout API call.";
}

function field(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

type Family = "callbacks" | "api" | "webhooks" | "actions";

function family(entry: TimelineEntry): Family {
  if (entry.kind === "api_call") return "api";
  if (entry.kind === "webhook") return "webhooks";
  if (entry.kind === "action" || entry.kind === "state") return "actions";
  return "callbacks";
}

interface Row {
  title: string;
  source: string;
  summary?: string;
  tone: "neutral" | "ok" | "error" | "info";
  badge?: string;
}

function describe(entry: TimelineEntry): Row {
  if (entry.kind === "api_call") {
    const api = entry.payload as { response?: unknown; error?: string };
    const endpoint = entry.name.replace(/^(MIT )?Checkout API\s*/, "");
    const method = /^GET\b/.test(endpoint) ? "" : "POST ";
    const failed = Boolean(api?.error) || Number(entry.status) >= 400;
    const outcome = text(field(api?.response, "resultCode")) ??
      text(field(api?.response, "status")) ?? (failed ? api?.error : undefined);
    return {
      title: `${method}${endpoint}`,
      source: "API",
      summary: [outcome, entry.durationMs ? `${entry.durationMs} ms` : undefined]
        .filter(Boolean).join(" · "),
      tone: failed ? "error" : "ok",
      badge: failed ? String(entry.status) : undefined,
    };
  }
  if (entry.kind === "webhook") {
    const success = String(field(entry.payload, "success")) === "true";
    return {
      title: entry.name,
      source: "Webhook",
      summary: `${success ? "success" : "failure"} · HMAC ${entry.hmacValid ? "valid" : "invalid"}`,
      tone: entry.hmacValid && success ? "ok" : "error",
    };
  }
  if (entry.kind === "action" || entry.kind === "state") {
    return { title: entry.name, source: "Back Office", summary: entry.status, tone: "info" };
  }
  const meta = callbackMeta(entry.name);
  const summary = text(field(entry.payload, "resultCode")) ??
    text(field(entry.payload, "data.paymentMethod.type")) ??
    text(field(entry.payload, "paymentMethod.type")) ??
    text(field(entry.payload, "brand")) ??
    text(field(entry.payload, "message")) ??
    text(field(entry.payload, "id"));
  return {
    title: entry.name,
    source: meta.rank === "app" ? "Playground" : "Adyen Web",
    summary,
    tone: entry.name === "onPaymentFailed" || entry.name === "onError" ? "error" : "neutral",
    badge: RANK_LABEL[meta.rank],
  };
}

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

export function JsonBlock(props: { value: unknown; entryKey: string }) {
  const [expandedValues, setExpandedValues] = useState<Set<string>>(new Set());
  const folds: Fold[] = [];
  const rendered = prettyJson(foldLongValues(props.value, expandedValues, props.entryKey, folds)) ||
    "null";
  const parts = rendered.split(/@@FOLD:(\d+)@@/);
  const toggle = (key: string) =>
    setExpandedValues((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <pre class="json">
      {parts.map((part, index) => {
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
      })}
    </pre>
  );
}

function splitAdditionalData(value: unknown): { rest: unknown; additionalData: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { rest: value, additionalData: null };
  }
  const { additionalData, ...rest } = value as Record<string, unknown>;
  return { rest, additionalData: additionalData ?? null };
}

function EntryDetail(props: { entry: TimelineEntry; repeats: number }) {
  const { entry } = props;
  const api = entry.kind === "api_call"
    ? entry.payload as { request?: unknown; response?: unknown; error?: string }
    : null;
  const [tab, setTab] = useState<"response" | "request">("response");
  const [showAdditional, setShowAdditional] = useState(false);
  const { copied, copy } = useCopy();
  const source = api
    ? (tab === "request" ? api.request : api.error ? { error: api.error } : api.response)
    : entry.payload;
  const { rest, additionalData } = splitAdditionalData(source);
  const hint = entry.kind === "frontend_callback"
    ? callbackMeta(entry.name).hint
    : api
    ? apiHint(entry.name)
    : entry.kind === "webhook"
    ? "Sent by Adyen to this server; the HMAC signature is checked before anything is processed."
    : "Recorded by this playground.";
  const json = prettyJson(source);
  return (
    <div class="entry__detail">
      <p class="entry__hint">
        {hint}
        {props.repeats > 1 ? ` Showing the latest of ${props.repeats}.` : ""}
      </p>
      <div class="entry__toolbar">
        {api
          ? (
            <div class="mini-tabs" role="tablist">
              {(["response", "request"] as const).map((value) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                >
                  {value === "response" ? "Response" : "Request"}
                </button>
              ))}
            </div>
          )
          : <span class="entry__label">Payload</span>}
        <button type="button" class="text-button" onClick={() => copy(json, { raw: true })}>
          {copied === json ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <JsonBlock value={rest} entryKey={`${entry.id}:${tab}`} />
      {additionalData
        ? (
          <div class="entry__extra">
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
    </div>
  );
}

interface Group {
  entry: TimelineEntry;
  repeats: number;
}

/** Consecutive chatty callbacks of the same name collapse into one row. */
function groupEntries(entries: TimelineEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (
      last && entry.kind === "frontend_callback" && CHATTY.has(entry.name) &&
      last.entry.kind === "frontend_callback" && last.entry.name === entry.name
    ) {
      groups[groups.length - 1] = { entry, repeats: last.repeats + 1 };
    } else {
      groups.push({ entry, repeats: 1 });
    }
  }
  return groups;
}

const FILTERS: Array<{ id: "all" | Family; label: string }> = [
  { id: "all", label: "All" },
  { id: "callbacks", label: "Adyen Web" },
  { id: "api", label: "API" },
  { id: "webhooks", label: "Webhooks" },
  { id: "actions", label: "Actions" },
];

/**
 * One chronological list of everything a checkout did: Adyen Web callbacks,
 * the Checkout API calls this server made, the webhooks Adyen sent back, and
 * Back Office actions. Shared by the checkout's inspector and the Back Office.
 */
export function Timeline(props: { entries: TimelineEntry[]; empty: string }) {
  const [filter, setFilter] = useState<"all" | Family>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const counts = new Map<string, number>();
  for (const entry of props.entries) {
    counts.set(family(entry), (counts.get(family(entry)) ?? 0) + 1);
  }
  const visible = groupEntries(
    props.entries.filter((entry) => filter === "all" || family(entry) === filter),
  );
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div class="timeline-view">
      <div class="chips" role="tablist" aria-label="Filter events">
        {FILTERS.filter((item) => item.id === "all" || counts.get(item.id)).map((item) => (
          <button
            type="button"
            role="tab"
            class="chip"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span class="chip__count">
              {item.id === "all" ? props.entries.length : counts.get(item.id) ?? 0}
            </span>
          </button>
        ))}
      </div>
      {visible.length
        ? (
          <ol class="entries">
            {visible.map(({ entry, repeats }) => {
              const row = describe(entry);
              const expanded = open.has(entry.id);
              return (
                <li class={`entry entry--${row.tone}`} key={entry.id}>
                  <button
                    type="button"
                    class="entry__row"
                    aria-expanded={expanded}
                    onClick={() => toggle(entry.id)}
                  >
                    <span class={`entry__dot entry__dot--${family(entry)}`} aria-hidden="true" />
                    <span class="entry__main">
                      <span class="entry__title">
                        {row.title}
                        {repeats > 1 ? <span class="entry__repeat">×{repeats}</span> : null}
                      </span>
                      <span class="entry__meta">
                        <span>{row.source}</span>
                        {row.badge ? <span class="entry__badge">{row.badge}</span> : null}
                        {row.summary ? <span class="entry__summary">{row.summary}</span> : null}
                      </span>
                    </span>
                    <time class="entry__time" datetime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleTimeString()}
                    </time>
                  </button>
                  {expanded ? <EntryDetail entry={entry} repeats={repeats} /> : null}
                </li>
              );
            })}
          </ol>
        )
        : <p class="entries__empty">{props.empty}</p>}
    </div>
  );
}

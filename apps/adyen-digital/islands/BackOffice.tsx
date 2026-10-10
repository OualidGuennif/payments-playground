import { apiFetch, formatMinorAmount } from "@suite/ui/client.ts";
import { useCopy } from "@suite/ui/useCopy.ts";
import { useEffect, useState } from "preact/hooks";
import {
  type Capabilities,
  LifecyclePanel,
  type Modification,
  type Permission,
} from "../components/LifecyclePanel.tsx";
import {
  attemptStatus,
  isAbandoned,
  type LedgerLike,
  orderStatus,
  type Tone,
} from "../components/status.ts";
import { Timeline, type TimelineEntry } from "../components/Timeline.tsx";

interface Attempt {
  id: string;
  state: string;
  paymentMethod?: string;
  pspReference?: string;
  refusalReason?: string;
}

interface Order {
  id: string;
  reference: string;
  flow: string;
  state: string;
  amount: { value: number; currency: string };
  paidValue: number;
  createdAt: string;
  updatedAt: string;
  attempts: Attempt[];
  ledger: LedgerLike;
  modifications: Modification[];
  capabilities: Capabilities;
  permissions: {
    capture: Permission;
    cancel: Permission;
    refund: Permission;
  };
}

type Filter = "all" | "authorised" | "captured" | "refused";

const PAGE_SIZE = 12;
const REFRESH_MS = 4000;

const METHOD_NAMES: Record<string, string> = {
  scheme: "Card",
  storedPaymentMethod: "Saved card",
  googlepay: "Google Pay",
  applepay: "Apple Pay",
  paypal: "PayPal",
  klarna_account: "Klarna",
  klarna: "Klarna",
  ideal: "iDEAL",
  sepadirectdebit: "SEPA",
  paybybank: "Pay by Bank",
  wechatpayQR: "WeChat Pay",
  wero: "Wero",
  alma: "Alma",
  ancv: "ANCV",
  giftcard: "Gift card",
  facilypay_3x: "Oney 3x",
  facilypay_4x: "Oney 4x",
  amex: "Amex",
  visa: "Visa",
  mc: "Mastercard",
  cartebancaire: "Cartes Bancaires",
};

const FLOW_NAMES: Record<string, string> = {
  "sessions-dropin": "Sessions · Drop-in",
  "sessions-component": "Sessions · Component",
  "advanced-dropin": "Advanced · Drop-in",
  "advanced-component": "Advanced · Component",
  "api-only-pci": "API only",
  "pay-by-link": "Pay by Link",
  mit: "Merchant-initiated",
  "partial-payment": "Partial payment",
};

function methodName(order: Order): string | undefined {
  const method = order.attempts.findLast((attempt) => attempt.paymentMethod)?.paymentMethod;
  return method ? METHOD_NAMES[method] ?? method : undefined;
}

function relativeTime(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

// The metrics and filters group the finer labels the ledger gives.
const AUTHORISED_LABELS = new Set(["Authorised", "Capture requested", "Cancel requested"]);
const CAPTURED_LABELS = new Set([
  "Captured",
  "Partially captured",
  "Refund requested",
  "Partially refunded",
  "Refunded",
]);

function matchesFilter(order: Order, filter: Filter): boolean {
  if (filter === "all") return true;
  const label = orderStatus(order).label;
  if (filter === "authorised") return AUTHORISED_LABELS.has(label);
  if (filter === "captured") return CAPTURED_LABELS.has(label);
  return label === "Refused";
}

function Pill(props: { tone: Tone; children: string }) {
  return <span class={`status-pill status-pill--${props.tone}`}>{props.children}</span>;
}

export default function BackOffice() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [merchantAccount, setMerchantAccount] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  async function refresh() {
    const response = await apiFetch<{ orders: Order[] }>("/api/digital/orders");
    setOrders(response.orders);
    setSelectedId((current) => {
      if (current) return current;
      const queryId = new URLSearchParams(globalThis.location.search).get("orderId");
      if (queryId && response.orders.some((order) => order.id === queryId)) return queryId;
      // A desktop opens on the latest paid order; a phone starts on the list.
      if (globalThis.matchMedia?.("(max-width: 860px)").matches) return null;
      return response.orders.find((order) => !isAbandoned(order))?.id ?? null;
    });
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Load failed."));
    // Named in the manual-capture warning; not a secret.
    apiFetch<{ profile?: { merchantAccount?: string } }>("/api/bootstrap")
      .then((data) => setMerchantAccount(data.profile?.merchantAccount))
      .catch(() => undefined);
    // Webhooks change orders behind the page's back: a capture becomes
    // "Captured" a few seconds after the button is pressed.
    const interval = globalThis.setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => undefined);
    }, REFRESH_MS);
    return () => globalThis.clearInterval(interval);
  }, []);

  const selected = orders?.find((order) => order.id === selectedId);
  const selectedSignature = selected ? `${selected.id}:${selected.updatedAt}` : "";
  useEffect(() => {
    if (!selectedId) return;
    apiFetch<{ entries: TimelineEntry[] }>(`/api/timeline/${selectedId}`)
      .then((response) => setTimeline(response.entries))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Timeline failed."));
  }, [selectedSignature, selectedId]);

  if (!orders) {
    return error
      ? <div class="notice notice--danger" role="alert">{error}</div>
      : <p class="muted" aria-live="polite">Loading orders…</p>;
  }

  const abandoned = orders.filter(isAbandoned);
  const labels = orders.map((order) => orderStatus(order).label);
  const count = (group: Set<string>) => labels.filter((value) => group.has(value)).length;
  const needle = query.trim().toLowerCase();
  const visible = orders
    .filter((order) => showAbandoned || !isAbandoned(order) || order.id === selectedId)
    .filter((order) => matchesFilter(order, filter))
    .filter((order) =>
      !needle ||
      order.reference.toLowerCase().includes(needle) ||
      order.id.includes(needle) ||
      order.attempts.some((attempt) => attempt.pspReference?.toLowerCase().includes(needle))
    );
  const shown = visible.slice(0, limit);

  return (
    <div class="bo">
      <div class="bo-metrics">
        <div class="bo-metric">
          <span>Authorised</span>
          <strong>{count(AUTHORISED_LABELS)}</strong>
          <small>awaiting capture</small>
        </div>
        <div class="bo-metric">
          <span>Captured</span>
          <strong>{count(CAPTURED_LABELS)}</strong>
        </div>
        <div class="bo-metric">
          <span>Refused</span>
          <strong>{count(new Set(["Refused"]))}</strong>
        </div>
        <div class="bo-metric">
          <span>Not paid</span>
          <strong>{abandoned.length}</strong>
          <small>checkouts opened and left</small>
        </div>
      </div>

      <div class="bo-toolbar">
        <input
          class="bo-search"
          type="search"
          placeholder="Search a reference or PSP reference"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          aria-label="Search orders"
        />
        <div class="chips" role="tablist" aria-label="Filter orders">
          {(["all", "authorised", "captured", "refused"] as const).map((value) => (
            <button
              type="button"
              role="tab"
              class="chip"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <label class="bo-toggle">
          <input
            type="checkbox"
            checked={showAbandoned}
            onChange={(event) => setShowAbandoned(event.currentTarget.checked)}
          />
          Show not paid ({abandoned.length})
        </label>
      </div>

      {error ? <div class="notice notice--danger" role="alert">{error}</div> : null}

      <div class={`bo-layout${selected ? " has-selection" : ""}`}>
        <section class="bo-list" aria-label="Orders">
          {shown.length
            ? shown.map((order) => {
              const status = orderStatus(order);
              const method = methodName(order);
              return (
                <button
                  type="button"
                  class="bo-row"
                  key={order.id}
                  aria-current={order.id === selectedId ? "true" : undefined}
                  onClick={() => setSelectedId(order.id)}
                >
                  <span class="bo-row__main">
                    <strong>{formatMinorAmount(order.amount.value, order.amount.currency)}</strong>
                    <span>
                      {[method, FLOW_NAMES[order.flow] ?? order.flow].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span class="bo-row__side">
                    <Pill tone={status.tone}>{status.label}</Pill>
                    <time datetime={order.createdAt}>{relativeTime(order.createdAt)}</time>
                  </span>
                </button>
              );
            })
            : (
              <p class="muted bo-empty">
                {orders.length
                  ? "No order matches these filters."
                  : "No payment yet. Start one from the Checkout tab."}
              </p>
            )}
          {visible.length > shown.length
            ? (
              <button
                type="button"
                class="text-button bo-more"
                onClick={() => setLimit(limit + PAGE_SIZE)}
              >
                Show more ({visible.length - shown.length})
              </button>
            )
            : null}
        </section>

        {selected
          ? (
            <section class="bo-detail" aria-label="Order details">
              <button type="button" class="text-button bo-back" onClick={() => setSelectedId(null)}>
                ← All orders
              </button>
              {(() => {
                const status = orderStatus(selected);
                const amount = formatMinorAmount(selected.amount.value, selected.amount.currency);
                return (
                  <>
                    <header class="bo-detail__head">
                      <div>
                        <span class="bo-detail__amount">{amount}</span>
                        <Pill tone={status.tone}>{status.label}</Pill>
                      </div>
                      {status.detail ? <p>{status.detail}</p> : null}
                    </header>

                    <LifecyclePanel
                      order={selected}
                      methodName={METHOD_NAMES[selected.capabilities.paymentMethod] ??
                        selected.capabilities.paymentMethod}
                      merchantAccount={merchantAccount}
                      onChanged={refresh}
                    />

                    <dl class="facts bo-facts">
                      <dt>Reference</dt>
                      <dd>
                        <button
                          type="button"
                          class="text-button mono"
                          onClick={() => copy(selected.reference)}
                        >
                          {copied === selected.reference ? "Copied" : selected.reference}
                        </button>
                      </dd>
                      <dt>Flow</dt>
                      <dd>{FLOW_NAMES[selected.flow] ?? selected.flow}</dd>
                      <dt>Created</dt>
                      <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                    </dl>

                    <div class="bo-section">
                      <h3>Payment attempts</h3>
                      {selected.attempts.length
                        ? (
                          <ul class="bo-attempts">
                            {selected.attempts.map((attempt) => {
                              const attemptState = attemptStatus(attempt.state);
                              return (
                                <li key={attempt.id}>
                                  <span class="bo-attempts__main">
                                    <strong>
                                      {METHOD_NAMES[attempt.paymentMethod ?? ""] ??
                                        attempt.paymentMethod ?? "Payment"}
                                    </strong>
                                    {attempt.pspReference
                                      ? (
                                        <button
                                          type="button"
                                          class="text-button mono"
                                          onClick={() => copy(attempt.pspReference as string)}
                                        >
                                          {copied === attempt.pspReference
                                            ? "Copied"
                                            : attempt.pspReference}
                                        </button>
                                      )
                                      : <span class="muted">No PSP reference yet</span>}
                                    {attempt.refusalReason
                                      ? <span class="muted">{attempt.refusalReason}</span>
                                      : null}
                                  </span>
                                  <Pill tone={attemptState.tone}>{attemptState.label}</Pill>
                                </li>
                              );
                            })}
                          </ul>
                        )
                        : <p class="muted">Nobody tried to pay this order.</p>}
                    </div>

                    <div class="bo-section">
                      <h3>Timeline</h3>
                      <Timeline
                        entries={timeline}
                        empty="Nothing recorded for this order yet."
                      />
                    </div>
                  </>
                );
              })()}
            </section>
          )
          : null}
      </div>
    </div>
  );
}

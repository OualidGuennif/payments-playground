import { apiFetch, formatMinorAmount } from "@suite/ui/client.ts";
import { useCopy } from "@suite/ui/useCopy.ts";
import { useRef, useState } from "preact/hooks";
import type { LedgerLike } from "./status.ts";

export interface Permission {
  allowed: boolean;
  reason: string;
  waiting?: boolean;
  maxValue?: number;
  partial?: boolean;
}

export interface Modification {
  kind: Action;
  status: "pending" | "succeeded" | "failed" | "reversed" | "rejected";
  value?: number;
  pspReference?: string;
  reason?: string;
  idempotencyKey?: string;
  requestedAt?: string;
  settledAt?: string;
  external: boolean;
}

export interface Capabilities {
  paymentMethod: string;
  separateCapture: boolean;
  partialCapture: boolean;
  multiplePartialCaptures: boolean;
  refund: boolean;
  partialRefund: boolean;
  multiplePartialRefunds: boolean;
  automaticCapture: boolean;
  notes: string;
  sourceUrl: string;
}

export interface LifecycleOrder {
  id: string;
  amount: { currency: string };
  ledger: LedgerLike;
  modifications: Modification[];
  capabilities: Capabilities;
  permissions: Record<Action, Permission>;
}

type Action = "capture" | "cancel" | "refund";

const LABEL: Record<Action, string> = {
  capture: "Capture",
  cancel: "Cancel authorisation",
  refund: "Refund",
};
const WEBHOOK: Record<Action, string> = {
  capture: "CAPTURE",
  cancel: "CANCELLATION",
  refund: "REFUND",
};
const STATUS: Record<Modification["status"], { label: string; tone: string }> = {
  pending: { label: "Waiting for webhook", tone: "warning" },
  succeeded: { label: "Succeeded", tone: "positive" },
  failed: { label: "Failed", tone: "danger" },
  reversed: { label: "Reversed", tone: "danger" },
  rejected: { label: "Rejected by the API", tone: "danger" },
};

function exponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function toMajor(value: number, currency: string): string {
  const digits = exponent(currency);
  return (value / 10 ** digits).toFixed(digits);
}

function toMinor(text: string, currency: string): number | null {
  const number = Number(text.replace(",", ".").trim());
  if (!text.trim() || !Number.isFinite(number)) return null;
  return Math.round(number * 10 ** exponent(currency));
}

function yes(value: boolean): string {
  return value ? "✓" : "✗";
}

/**
 * Capture, cancel and refund for one order, the way Adyen means them:
 * every request carries an Idempotency-Key minted for that intent, a request
 * Adyen answered "received" disables its button until the webhook arrives,
 * and the totals are what the webhooks settled.
 */
export function LifecyclePanel(props: {
  order: LifecycleOrder;
  methodName: string;
  merchantAccount?: string;
  onChanged: () => Promise<void>;
}) {
  const { order } = props;
  const currency = order.amount.currency;
  const ledger = order.ledger;
  const capabilities = order.capabilities;
  const [drafts, setDrafts] = useState<Partial<Record<Action, string>>>({});
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // One key per intent (order, action, amount): a retry after a lost
  // response is the same request to Adyen, which answers it from its cache
  // instead of capturing twice. A new intent gets a new key.
  const keys = useRef(new Map<string, string>());
  const { copied, copy } = useCopy();
  const money = (value: number) => formatMinorAmount(value, currency);

  async function run(action: Action) {
    const permission = order.permissions[action];
    let value: number | undefined;
    if (action !== "cancel") {
      const max = permission.maxValue ?? 0;
      value = permission.partial
        ? toMinor(drafts[action] ?? toMajor(max, currency), currency) ?? 0
        : max;
      if (value < 1 || value > max) {
        setMessage({
          tone: "error",
          text: `Enter an amount between ${money(1)} and ${money(max)}.`,
        });
        return;
      }
    }
    const intent = `${order.id}:${action}:${value ?? ""}`;
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    setBusy(action);
    setMessage(null);
    try {
      await apiFetch(`/api/digital/orders/${order.id}/actions/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(value ? { amount: { value, currency } } : {}),
      });
      keys.current.delete(intent);
      setDrafts((current) => ({ ...current, [action]: undefined }));
      setMessage({
        tone: "ok",
        text: `Adyen received the ${action}${value ? ` of ${money(value)}` : ""}. The ${
          WEBHOOK[action]
        } webhook decides how it ends.`,
      });
      await props.onChanged();
    } catch (cause) {
      // No answer at all (a TypeError from fetch): keep the key, so trying
      // again cannot become a second capture. Any answer ends the intent.
      if (!(cause instanceof TypeError)) keys.current.delete(intent);
      setMessage({
        tone: "error",
        text: cause instanceof Error ? cause.message : "The request failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  const manualCapture = capabilities.separateCapture && !capabilities.automaticCapture;
  const actions: Action[] = ["capture", "refund", "cancel"];
  const allowed = actions.filter((action) => order.permissions[action].allowed);
  const waiting = actions.filter((action) => order.permissions[action].waiting);
  const blocked = actions.filter((action) =>
    !order.permissions[action].allowed && !order.permissions[action].waiting
  );

  return (
    <div class="lc">
      {manualCapture
        ? (
          <div class="notice notice--warning lc-warning" role="note">
            <strong>
              {props.merchantAccount ?? "This merchant account"} captures {props.methodName}{" "}
              manually.
            </strong>
            <p>
              Payments stay authorised until they are captured, here or in the Customer Area. Check
              that this is the setup you need; otherwise set immediate capture in the Customer Area
              (capture delay, for the account or per payment method), or send{" "}
              <code>captureDelayHours</code> with each payment.
            </p>
          </div>
        )
        : null}

      <dl class="lc-ledger">
        <div>
          <dt>Authorised</dt>
          <dd>{money(ledger.authorised)}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>
            {money(ledger.captured)}
            {ledger.capturePending ? <small>{money(ledger.capturePending)} pending</small> : null}
          </dd>
        </div>
        <div>
          <dt>Refunded</dt>
          <dd>
            {money(ledger.refunded)}
            {ledger.refundPending ? <small>{money(ledger.refundPending)} pending</small> : null}
          </dd>
        </div>
      </dl>

      {allowed.length || waiting.length
        ? (
          <div class="lc-actions">
            {[...allowed, ...waiting].map((action, index) => {
              const permission = order.permissions[action];
              if (permission.waiting) {
                return (
                  <div class="lc-action" key={action}>
                    <button type="button" class="button button--secondary lc-waiting" disabled>
                      <span class="spinner spinner--small" aria-hidden="true" />
                      Waiting for the {WEBHOOK[action]} webhook
                    </button>
                    <small>
                      Adyen answered "received". The outcome arrives by webhook, which only reaches
                      a server Adyen can call (the deployed playground, not localhost).
                    </small>
                  </div>
                );
              }
              const max = permission.maxValue ?? 0;
              const draft = drafts[action] ?? (max ? toMajor(max, currency) : "");
              const value = action === "cancel"
                ? undefined
                : permission.partial
                ? toMinor(draft, currency)
                : max;
              return (
                <div class="lc-action" key={action}>
                  <div class="lc-action__row">
                    {action !== "cancel" && permission.partial
                      ? (
                        <label class="lc-amount">
                          <span class="sr-only">{LABEL[action]} amount</span>
                          <input
                            inputMode="decimal"
                            value={draft}
                            aria-describedby={`lc-${action}-hint`}
                            onInput={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [action]: event.currentTarget.value,
                              }))}
                          />
                          <span>{currency}</span>
                        </label>
                      )
                      : null}
                    <button
                      type="button"
                      class={`button ${
                        index === 0 && action !== "cancel" ? "button--primary" : "button--secondary"
                      }`}
                      disabled={Boolean(busy)}
                      onClick={() => run(action)}
                    >
                      {busy === action
                        ? "Sending…"
                        : action === "cancel"
                        ? LABEL.cancel
                        : `${LABEL[action]} ${value ? money(value) : ""}`}
                    </button>
                  </div>
                  <small id={`lc-${action}-hint`}>
                    {action !== "cancel" && permission.partial
                      ? `Up to ${money(max)}. ${permission.reason}`
                      : permission.reason}
                  </small>
                </div>
              );
            })}
          </div>
        )
        : null}

      {message
        ? (
          <div
            class={`notice${message.tone === "error" ? " notice--danger" : ""}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        )
        : null}

      {blocked.length
        ? (
          <ul class="bo-reasons">
            {blocked.map((action) => (
              <li key={action}>
                <strong>{LABEL[action]}:</strong> {order.permissions[action].reason}
              </li>
            ))}
          </ul>
        )
        : null}

      {order.modifications.length
        ? (
          <div class="bo-section">
            <h3>Captures, cancels and refunds</h3>
            <ol class="lc-history">
              {order.modifications.map((modification, index) => {
                const status = STATUS[modification.status];
                return (
                  <li key={`${modification.pspReference ?? modification.idempotencyKey}-${index}`}>
                    <span class="lc-history__main">
                      <strong>
                        {LABEL[modification.kind].replace(" authorisation", "")}
                        {modification.value !== undefined ? ` ${money(modification.value)}` : ""}
                      </strong>
                      <small>
                        {modification.external ? "Sent outside this playground · " : ""}
                        {modification.requestedAt ?? modification.settledAt
                          ? new Date(
                            (modification.requestedAt ?? modification.settledAt) as string,
                          ).toLocaleString()
                          : ""}
                        {modification.reason ? ` · ${modification.reason}` : ""}
                      </small>
                      <span class="lc-history__refs">
                        {modification.pspReference
                          ? (
                            <button
                              type="button"
                              class="text-button mono"
                              title="Copy the modification's PSP reference"
                              onClick={() => copy(modification.pspReference as string)}
                            >
                              {copied === modification.pspReference
                                ? "Copied"
                                : modification.pspReference}
                            </button>
                          )
                          : null}
                        {modification.idempotencyKey
                          ? (
                            <button
                              type="button"
                              class="text-button mono"
                              title="Copy the Idempotency-Key sent with this request"
                              onClick={() => copy(modification.idempotencyKey as string)}
                            >
                              {copied === modification.idempotencyKey
                                ? "Copied"
                                : `key ${modification.idempotencyKey.slice(0, 8)}…`}
                            </button>
                          )
                          : null}
                      </span>
                    </span>
                    <span class={`status-pill status-pill--${status.tone}`}>{status.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )
        : null}

      <p class="lc-caps">
        {props.methodName}: separate capture {yes(capabilities.separateCapture)} · partial{" "}
        {yes(capabilities.partialCapture)} · multiple partial{" "}
        {yes(capabilities.multiplePartialCaptures)} · refunds {yes(capabilities.refund)} · partial
        {" "}
        {yes(capabilities.partialRefund)} · multiple partial{" "}
        {yes(capabilities.multiplePartialRefunds)}. {capabilities.notes}{" "}
        <a href={capabilities.sourceUrl} target="_blank" rel="noopener noreferrer">
          Adyen docs ↗
        </a>
      </p>
    </div>
  );
}

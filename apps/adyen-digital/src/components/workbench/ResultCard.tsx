import { useCopy } from "@suite/ui/useCopy.ts";
import type { PaymentOutcome } from "../../checkout/client.ts";
import type { RetryMode } from "../../checkout/session-renewal.ts";
import { resultCodeStatus } from "../../lib/status.ts";

export type { PaymentOutcome, RetryMode };

/**
 * The server's renewal: waiting for Adyen's refusal webhooks (`refusals` null before the first
 * answer), or what stopped it (`refused` when the server said no for this order).
 */
export type Renewal =
  | { phase: "waiting"; refusals: number | null; limit: number }
  | { phase: "failed"; message: string; refused: boolean };

const RETRY_DETAIL: Record<RetryMode, string> = {
  same: "The checkout stays open, and so does anything already paid: try again with this method or another.",
  renew:
    "Adyen takes no more payments in this session (5 refusals). Trying again asks the server for a new session on the same order; it opens one once Adyen's webhooks confirm the refusals.",
  new: "This order takes no more payments: a new checkout starts a new order.",
};

const RETRY_LABEL: Record<RetryMode, string> = {
  same: "Try again",
  renew: "Try again",
  new: "Start a new checkout",
};

export function ResultCard(props: {
  outcome: PaymentOutcome;
  amountText: string;
  orderId: string | null;
  /** The in-page reset, or a link back to the flow when there is no page state to reset. */
  onRestart?: () => void;
  restartHref?: string;
  /** After a failed payment, the one way on: what it does follows `retryMode`. */
  onRetry?: () => void;
  retryMode?: RetryMode;
  renewal?: Renewal | null;
}) {
  const status = resultCodeStatus(props.outcome.resultCode);
  // Only an outcome that is not a payment can be retried.
  const retry = status.tone === "danger" || status.tone === "neutral" ? props.onRetry : undefined;
  const { copied, copy } = useCopy();
  const waiting = props.renewal?.phase === "waiting" ? props.renewal : null;
  const failed = props.renewal?.phase === "failed" ? props.renewal : null;
  const icon =
    status.tone === "positive"
      ? "✓"
      : status.tone === "danger"
        ? "✕"
        : status.tone === "warning"
          ? "…"
          : "•";
  return (
    <div className={`result result--${status.tone}`} role="status">
      <span className="result__icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{status.label}</h3>
      <p className="result__amount">{props.amountText}</p>
      <p className="result__detail">
        {status.detail ??
          (status.tone === "positive"
            ? "Follow it in the Back Office, where you can capture, cancel or refund it as the method allows."
            : retry
              ? RETRY_DETAIL[props.retryMode ?? "same"]
              : "You can start a new payment straight away.")}
      </p>
      {waiting ? (
        <p className="result__detail" role="status">
          {waiting.refusals === null
            ? "Asking the server for a new session…"
            : `Waiting for Adyen to confirm the refusals of this session (${waiting.refusals}/${waiting.limit}).`}
        </p>
      ) : null}
      {failed ? (
        <p className="result__detail" role="alert">
          {failed.message}
        </p>
      ) : null}
      <dl className="facts">
        {props.outcome.resultCode ? (
          <>
            <dt>Result code</dt>
            <dd>{props.outcome.resultCode}</dd>
          </>
        ) : null}
        {props.outcome.method ? (
          <>
            <dt>Method</dt>
            <dd>{props.outcome.method}</dd>
          </>
        ) : null}
        {props.outcome.pspReference ? (
          <>
            <dt>PSP reference</dt>
            <dd>
              <button
                type="button"
                className="text-button mono"
                title="Copy"
                onClick={() => copy(props.outcome.pspReference as string)}
              >
                {props.outcome.pspReference}
                {copied === props.outcome.pspReference ? " · copied" : ""}
              </button>
            </dd>
          </>
        ) : null}
      </dl>
      <div className="result__actions">
        {/* One way on after a failed payment: a second "New payment" would open a new order from
            the browser, around the server's renewal decision (ADR-022). */}
        {retry ? (
          <button
            className="button button--primary"
            type="button"
            onClick={retry}
            disabled={Boolean(waiting)}
            aria-busy={Boolean(waiting)}
          >
            {waiting ? "Waiting for Adyen…" : RETRY_LABEL[props.retryMode ?? "same"]}
          </button>
        ) : props.onRestart ? (
          <button className="button button--primary" type="button" onClick={props.onRestart}>
            New payment
          </button>
        ) : (
          <a className="button button--primary" href={props.restartHref ?? "/"}>
            New payment
          </a>
        )}
        {props.orderId ? (
          <a className="button button--secondary" href={`/back-office?orderId=${props.orderId}`}>
            Open in Back Office
          </a>
        ) : null}
      </div>
    </div>
  );
}

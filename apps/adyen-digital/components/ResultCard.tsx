import { useCopy } from "@suite/ui/useCopy.ts";
import { resultCodeStatus } from "./status.ts";

/** What the result screen shows once a payment has an outcome. */
export interface PaymentOutcome {
  resultCode?: string;
  pspReference?: string;
  method?: string;
}

export function ResultCard(props: {
  outcome: PaymentOutcome;
  amountText: string;
  orderId: string | null;
  /** The in-page reset, or a link back to the flow when there is no page state to reset. */
  onRestart?: () => void;
  restartHref?: string;
  /** Another attempt in the same checkout: same session, same order. */
  onRetry?: () => void;
  /** The session takes no more payments (5 refusals, closed or expired): a retry starts a new one. */
  retryStartsOver?: boolean;
}) {
  const status = resultCodeStatus(props.outcome.resultCode);
  // Only an outcome that is not a payment can be retried.
  const retry = status.tone === "danger" || status.tone === "neutral" ? props.onRetry : undefined;
  const { copied, copy } = useCopy();
  const icon = status.tone === "positive"
    ? "✓"
    : status.tone === "danger"
    ? "✕"
    : status.tone === "warning"
    ? "…"
    : "•";
  return (
    <div class={`result result--${status.tone}`} role="status">
      <span class="result__icon" aria-hidden="true">{icon}</span>
      <h3>{status.label}</h3>
      <p class="result__amount">{props.amountText}</p>
      <p class="result__detail">
        {status.detail ??
          (status.tone === "positive"
            ? "Follow it in the Back Office, where you can capture, cancel or refund it as the method allows."
            : retry && props.retryStartsOver
            ? "Adyen takes no more payments in this session (5 refusals, or it expired): trying again opens a new one."
            : retry
            ? "The checkout stays open, and so does anything already paid: try again with this method or another."
            : "You can start a new payment straight away.")}
      </p>
      <dl class="facts">
        {props.outcome.resultCode
          ? (
            <>
              <dt>Result code</dt>
              <dd>{props.outcome.resultCode}</dd>
            </>
          )
          : null}
        {props.outcome.method
          ? (
            <>
              <dt>Method</dt>
              <dd>{props.outcome.method}</dd>
            </>
          )
          : null}
        {props.outcome.pspReference
          ? (
            <>
              <dt>PSP reference</dt>
              <dd>
                <button
                  type="button"
                  class="text-button mono"
                  title="Copy"
                  onClick={() => copy(props.outcome.pspReference as string)}
                >
                  {props.outcome.pspReference}
                  {copied === props.outcome.pspReference ? " · copied" : ""}
                </button>
              </dd>
            </>
          )
          : null}
      </dl>
      <div class="result__actions">
        {retry
          ? (
            <button class="button button--primary" type="button" onClick={retry}>
              Try again
            </button>
          )
          : null}
        {props.onRestart
          ? (
            <button
              class={`button ${retry ? "button--secondary" : "button--primary"}`}
              type="button"
              onClick={props.onRestart}
            >
              New payment
            </button>
          )
          : <a class="button button--primary" href={props.restartHref ?? "/"}>New payment</a>}
        {props.orderId
          ? (
            <a class="button button--secondary" href={`/back-office?orderId=${props.orderId}`}>
              Open in Back Office
            </a>
          )
          : null}
      </div>
    </div>
  );
}

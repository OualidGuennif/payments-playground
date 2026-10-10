/**
 * Plain-language labels for what the API stores as machine states. The order
 * state model is unchanged (packages/platform/state-machine.ts); this only
 * says, for a person, what each state means right now.
 */

export type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

export interface StatusLabel {
  label: string;
  tone: Tone;
  /** One line explaining what happens next, when there is anything to say. */
  detail?: string;
}

interface OrderLike {
  state: string;
  paidValue: number;
  amount: { value: number };
  attempts: Array<{ state: string }>;
  permissions?: { refund?: { allowed: boolean } };
}

/** An order nobody tried to pay: a checkout that was opened and left. */
export function isAbandoned(order: OrderLike): boolean {
  return order.state === "open" && order.attempts.length === 0;
}

export function orderStatus(order: OrderLike): StatusLabel {
  const refused = order.attempts.some((attempt) => attempt.state === "refused");
  switch (order.state) {
    case "paid":
      return { label: "Captured", tone: "positive", detail: "The money is captured." };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", detail: "The authorisation was released." };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "partially_paid":
      return {
        label: "Partially authorised",
        tone: "warning",
        detail: "Part of the amount is authorised; the rest is still due.",
      };
    case "payment_pending":
      if (order.paidValue >= order.amount.value) {
        // Methods captured on authorisation (PayPal here, Wero, iDEAL...) can
        // already be refunded: for them, authorised means captured.
        return order.permissions?.refund?.allowed
          ? { label: "Captured", tone: "positive", detail: "Captured on authorisation." }
          : {
            label: "Authorised",
            tone: "info",
            detail: "Awaiting capture. Capture it, or cancel to release the funds.",
          };
      }
      return {
        label: "Pending",
        tone: "warning",
        detail: "Waiting for the shopper or the payment method to finish.",
      };
    case "open":
    default:
      if (order.attempts.length === 0) {
        return { label: "Not paid", tone: "neutral", detail: "Checkout opened, never paid." };
      }
      return refused
        ? { label: "Refused", tone: "danger", detail: "The last attempt was refused." }
        : { label: "Awaiting payment", tone: "neutral" };
  }
}

export function attemptStatus(state: string): StatusLabel {
  switch (state) {
    case "authorised":
      return { label: "Authorised", tone: "positive" };
    case "refused":
      return { label: "Refused", tone: "danger" };
    case "pending":
      return { label: "Pending", tone: "warning" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    default:
      return { label: "Created", tone: "neutral" };
  }
}

/** What a shopper-facing result screen says for an Adyen resultCode. */
export function resultCodeStatus(resultCode: string | undefined): StatusLabel {
  switch ((resultCode ?? "").toLowerCase()) {
    case "authorised":
      return { label: "Payment authorised", tone: "positive" };
    case "refused":
      return { label: "Payment refused", tone: "danger" };
    case "cancelled":
      return { label: "Payment cancelled", tone: "neutral" };
    case "error":
      return { label: "Payment error", tone: "danger" };
    case "pending":
    case "received":
      return {
        label: "Payment pending",
        tone: "warning",
        detail: "The payment method will confirm it later; a webhook will tell the server.",
      };
    default:
      return { label: resultCode ? `Result: ${resultCode}` : "Payment finished", tone: "neutral" };
  }
}

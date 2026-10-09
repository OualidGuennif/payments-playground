import type {
  ActionPermissions,
  AttemptAggregate,
  LifecycleCapabilities,
  OrderState,
} from "./types.ts";

export const PAYMENT_METHOD_CAPABILITIES: Record<string, LifecycleCapabilities> = {
  scheme: {
    paymentMethod: "scheme",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Captured manually on this TEST account (owner, 2026-10-09).",
    sourceUrl: "https://docs.adyen.com/online-payments/capture",
  },
  ideal: {
    paymentMethod: "ideal",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 24 * 60,
    notes: "iDEAL is captured immediately; separate and partial captures are not supported.",
    sourceUrl: "https://docs.adyen.com/payment-methods/ideal",
  },
  mbway: {
    paymentMethod: "mbway",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 30,
    notes: "MB WAY is direct and does not support separate capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/mb-way",
  },
  paypal: {
    paymentMethod: "paypal",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 24 * 60,
    notes:
      "Adyen supports separate capture for PayPal, but this TEST account captures it on authorisation (owner, 2026-10-09).",
    sourceUrl: "https://docs.adyen.com/payment-methods/paypal",
  },
  giftcard: {
    paymentMethod: "giftcard",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 24 * 60,
    notes: "Use Checkout /orders for split tender and partial payment flows.",
    sourceUrl: "https://docs.adyen.com/online-payments/partial-payments",
  },
  // Supported features read from each method's Adyen docs page on 2026-10-09.
  // Methods that support separate capture are captured manually on this TEST
  // account, like cards; only PayPal is captured on authorisation.
  googlepay: {
    paymentMethod: "googlepay",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Card payment in a wallet; follows the card capture setting.",
    sourceUrl: "https://docs.adyen.com/payment-methods/google-pay",
  },
  applepay: {
    paymentMethod: "applepay",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Card payment in a wallet; follows the card capture setting.",
    sourceUrl: "https://docs.adyen.com/payment-methods/apple-pay",
  },
  klarna_account: {
    paymentMethod: "klarna_account",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Separate and partial captures supported.",
    sourceUrl: "https://docs.adyen.com/payment-methods/klarna",
  },
  alma: {
    paymentMethod: "alma",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 30 * 24 * 60,
    notes: "Must be captured within 30 days of authorisation.",
    sourceUrl: "https://docs.adyen.com/payment-methods/alma",
  },
  facilypay_3x: {
    paymentMethod: "facilypay_3x",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Oney 3x: separate and partial captures supported.",
    sourceUrl: "https://docs.adyen.com/payment-methods/oney",
  },
  facilypay_4x: {
    paymentMethod: "facilypay_4x",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Oney 4x: separate and partial captures supported.",
    sourceUrl: "https://docs.adyen.com/payment-methods/oney",
  },
  sepadirectdebit: {
    paymentMethod: "sepadirectdebit",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: true,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Separate and partial captures supported.",
    sourceUrl: "https://docs.adyen.com/payment-methods/sepa-direct-debit",
  },
  ancv: {
    paymentMethod: "ancv",
    separateCapture: true,
    automaticCapture: false,
    settlementOnly: false,
    refund: true,
    partialRefund: false,
    cancel: true,
    validityMinutes: 24 * 60,
    notes: "Refund only within 4 hours of capture, and never partially.",
    sourceUrl: "https://docs.adyen.com/payment-methods/ancv",
  },
  wero: {
    paymentMethod: "wero",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 24 * 60,
    notes: "No separate or partial capture; captured on authorisation.",
    sourceUrl: "https://docs.adyen.com/payment-methods/wero",
  },
  wechatpayQR: {
    paymentMethod: "wechatpayQR",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 24 * 60,
    notes: "No separate or partial capture; captured on authorisation.",
    sourceUrl: "https://docs.adyen.com/payment-methods/wechat-pay",
  },
  paybybank: {
    paymentMethod: "paybybank",
    separateCapture: false,
    automaticCapture: true,
    settlementOnly: true,
    refund: true,
    partialRefund: true,
    cancel: false,
    validityMinutes: 24 * 60,
    notes: "Pay by Bank (Europe): no separate or partial capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/pay-by-bank-europe",
  },
};

export function capabilitiesFor(paymentMethod: string | undefined): LifecycleCapabilities {
  return PAYMENT_METHOD_CAPABILITIES[paymentMethod ?? "scheme"] ??
    PAYMENT_METHOD_CAPABILITIES.scheme;
}

/**
 * The attempt a capture, cancel or refund applies to: the latest authorised
 * one. The latest attempt with any PSP reference could be a refusal, and
 * Adyen rejects a modification on a refused payment.
 */
export function lifecycleSourceAttempt(
  attempts: AttemptAggregate[],
): AttemptAggregate | undefined {
  return attempts.findLast((attempt) => attempt.state === "authorised" && attempt.pspReference);
}

/**
 * `authorisedValue` is the order's paid value. A method Adyen captures on
 * authorisation (iDEAL, PayPal here, gift cards) never sees a CAPTURE
 * webhook, so for those an authorised amount already counts as captured.
 */
export function actionPermissions(
  state: OrderState,
  paymentMethod?: string,
  authorisedValue = 0,
): ActionPermissions {
  const capabilities = capabilitiesFor(paymentMethod);
  const captured = state === "paid" ||
    (capabilities.automaticCapture && authorisedValue > 0 && state !== "cancelled");
  const pendingAuthorisation = state === "payment_pending" || state === "partially_paid";

  return {
    capture: {
      allowed: pendingAuthorisation && capabilities.separateCapture &&
        !capabilities.automaticCapture && !capabilities.settlementOnly,
      reason: !capabilities.separateCapture
        ? `${paymentMethod ?? "This method"} does not support separate capture.`
        : capabilities.settlementOnly
        ? "This playground profile is configured as settlement only."
        : captured
        ? "The payment is already captured."
        : pendingAuthorisation
        ? "Capture is allowed."
        : `Capture is unavailable while the order is ${state}.`,
    },
    cancel: {
      allowed: pendingAuthorisation && capabilities.cancel && !captured,
      reason: !capabilities.cancel
        ? `${paymentMethod ?? "This method"} cannot be cancelled before capture.`
        : captured
        ? "Captured payments must be refunded, not cancelled."
        : pendingAuthorisation
        ? "Cancellation is allowed."
        : `Cancellation is unavailable while the order is ${state}.`,
    },
    refund: {
      allowed: captured && capabilities.refund,
      reason: !capabilities.refund
        ? `${paymentMethod ?? "This method"} does not support refunds.`
        : captured
        ? "Refund is allowed."
        : "Only captured payments can be refunded.",
    },
  };
}

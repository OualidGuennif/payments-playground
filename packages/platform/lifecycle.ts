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
    notes: "Manual capture is available when enabled on the merchant account.",
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
      "Playground default: settlement only. Set separateCapture=true only after merchant configuration is verified.",
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

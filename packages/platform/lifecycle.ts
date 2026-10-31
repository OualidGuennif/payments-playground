// Spec: knowledge/components/platform-package.md
import type {
  ActionPermissions,
  AttemptAggregate,
  Ledger,
  LifecycleCapabilities,
  OrderState,
} from "./types.ts";

/**
 * Where the capability table below comes from, and when it was last checked.
 * Adyen changes what a method supports: re-check every entry against the
 * feature table on CAPABILITIES_SOURCE at least every three months, then
 * bump CAPABILITIES_REVIEWED_ON. lifecycle.test.ts fails once the review is
 * more than 92 days old, so a stale table cannot ship unnoticed.
 */
export const CAPABILITIES_SOURCE = "https://docs.adyen.com/payment-methods";
export const CAPABILITIES_REVIEWED_ON = "2026-10-10";

/**
 * Per payment method: what Adyen supports (separate, partial and multiple
 * partial captures; refunds, partial and multiple partial refunds), read
 * from CAPABILITIES_SOURCE, and how this TEST merchant account captures it
 * (automaticCapture).
 *
 * Two different things live here, and integrations go wrong when they are
 * confused:
 * - Adyen's limits. A method without separate capture (iDEAL, Wero, MB WAY,
 *   WeChat Pay, Pay by Bank Europe) is always captured on authorisation.
 *   Multiple partial captures also need Adyen Support to enable them on the
 *   merchant account; without that, Adyen cancels what is left after the
 *   first partial capture.
 * - The merchant account's setting. OGAccountECOM captures cards and the
 *   methods that follow them manually (owner, 2026-10-09): they stay
 *   authorised until captured. PayPal supports separate capture too, but
 *   the owner set it to capture on authorisation (2026-10-10). Either can be
 *   changed in the Customer Area (capture delay, per account or per payment
 *   method), or per payment with captureDelayHours.
 */
export const PAYMENT_METHOD_CAPABILITIES: Record<string, LifecycleCapabilities> = {
  scheme: {
    paymentMethod: "scheme",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes:
      "Cards (Visa, Mastercard, Amex, Cartes Bancaires...). Captured manually on this TEST account (owner, 2026-10-09), which has multiple partial captures enabled: a second partial capture was accepted on 2026-10-10.",
    sourceUrl: "https://docs.adyen.com/online-payments/capture",
  },
  googlepay: {
    paymentMethod: "googlepay",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Card payment in a wallet; follows the card capture setting.",
    sourceUrl: "https://docs.adyen.com/payment-methods/google-pay",
  },
  applepay: {
    paymentMethod: "applepay",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Card payment in a wallet; follows the card capture setting.",
    sourceUrl: "https://docs.adyen.com/payment-methods/apple-pay",
  },
  paypal: {
    paymentMethod: "paypal",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: true,
    validityMinutes: 24 * 60,
    notes:
      "Adyen supports separate and multiple partial captures for PayPal, but this TEST account captures it on authorisation (owner, 2026-10-10): it is refunded, never captured.",
    sourceUrl: "https://docs.adyen.com/payment-methods/paypal",
  },
  klarna: {
    paymentMethod: "klarna",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Klarna Pay later.",
    sourceUrl: "https://docs.adyen.com/payment-methods/klarna",
  },
  klarna_account: {
    paymentMethod: "klarna_account",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Klarna Pay over time.",
    sourceUrl: "https://docs.adyen.com/payment-methods/klarna",
  },
  klarna_paynow: {
    paymentMethod: "klarna_paynow",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Klarna Pay now.",
    sourceUrl: "https://docs.adyen.com/payment-methods/klarna",
  },
  alma: {
    paymentMethod: "alma",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 30 * 24 * 60,
    notes: "One partial capture at most; must be captured within 30 days of authorisation.",
    sourceUrl: "https://docs.adyen.com/payment-methods/alma",
  },
  facilypay_3x: {
    paymentMethod: "facilypay_3x",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Oney 3x: one partial capture at most.",
    sourceUrl: "https://docs.adyen.com/payment-methods/oney",
  },
  facilypay_4x: {
    paymentMethod: "facilypay_4x",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Oney 4x: one partial capture at most.",
    sourceUrl: "https://docs.adyen.com/payment-methods/oney",
  },
  sepadirectdebit: {
    paymentMethod: "sepadirectdebit",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Separate, partial and multiple partial captures.",
    sourceUrl: "https://docs.adyen.com/payment-methods/sepa-direct-debit",
  },
  ancv: {
    paymentMethod: "ancv",
    separateCapture: true,
    partialCapture: true,
    multiplePartialCaptures: true,
    refund: true,
    partialRefund: false,
    multiplePartialRefunds: false,
    automaticCapture: false,
    validityMinutes: 24 * 60,
    notes: "Refunded once, in full, and only within 4 hours of capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/ancv",
  },
  giftcard: {
    paymentMethod: "giftcard",
    separateCapture: true,
    partialCapture: false,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: false,
    automaticCapture: true,
    validityMinutes: 24 * 60,
    notes:
      "Captured in full on authorisation here; refunded once. Use Checkout /orders for split tender.",
    sourceUrl: "https://docs.adyen.com/payment-methods/gift-cards",
  },
  ideal: {
    paymentMethod: "ideal",
    separateCapture: false,
    partialCapture: false,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: true,
    validityMinutes: 24 * 60,
    notes: "Captured on authorisation; no separate capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/ideal",
  },
  mbway: {
    paymentMethod: "mbway",
    separateCapture: false,
    partialCapture: false,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: true,
    validityMinutes: 30,
    notes: "Captured on authorisation; no separate capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/mb-way",
  },
  wero: {
    paymentMethod: "wero",
    separateCapture: false,
    partialCapture: false,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: true,
    validityMinutes: 24 * 60,
    notes: "Captured on authorisation; no separate capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/wero",
  },
  wechatpayQR: {
    paymentMethod: "wechatpayQR",
    separateCapture: false,
    partialCapture: false,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: true,
    validityMinutes: 24 * 60,
    notes: "Captured on authorisation; no separate capture.",
    sourceUrl: "https://docs.adyen.com/payment-methods/wechat-pay",
  },
  paybybank: {
    paymentMethod: "paybybank",
    separateCapture: false,
    partialCapture: false,
    multiplePartialCaptures: false,
    refund: true,
    partialRefund: true,
    multiplePartialRefunds: true,
    automaticCapture: true,
    validityMinutes: 24 * 60,
    notes: "Pay by Bank (Europe): captured on authorisation; no separate capture.",
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

/** Nothing captured, refunded or pending: an authorisation of `authorised`. */
export function emptyLedger(authorised: number): Ledger {
  return {
    authorised,
    captured: 0,
    capturePending: 0,
    refunded: 0,
    refundPending: 0,
    cancelled: false,
    cancelPending: false,
  };
}

const CLOSED_STATES: ReadonlySet<OrderState> = new Set(["cancelled", "expired", "failed"]);

/**
 * What can be done next, from the ledger the webhooks settled. A request
 * Adyen answered "received" for blocks another of its kind until its
 * webhook arrives: the webhook is the outcome, the response only an
 * acknowledgement. A method captured on authorisation never sees a CAPTURE
 * webhook, so for those the authorised amount counts as captured.
 */
export function actionPermissions(
  state: OrderState,
  paymentMethod: string | undefined,
  ledger: Ledger,
): ActionPermissions {
  const capabilities = capabilitiesFor(paymentMethod);
  const name = paymentMethod ?? "This method";
  const live = ledger.authorised > 0 && !CLOSED_STATES.has(state) && !ledger.cancelled;
  const captured = capabilities.automaticCapture ? (live ? ledger.authorised : 0) : ledger.captured;
  const capturable = Math.max(0, ledger.authorised - captured - ledger.capturePending);
  const refundable = Math.max(0, captured - ledger.refunded - ledger.refundPending);

  const capture = (() => {
    if (!capabilities.separateCapture) {
      return {
        allowed: false,
        reason: `${name} has no separate capture: Adyen captures it on authorisation.`,
      };
    }
    if (capabilities.automaticCapture) {
      return {
        allowed: false,
        reason:
          `This merchant account captures ${name} on authorisation, so there is nothing to capture.`,
      };
    }
    if (ledger.cancelled) return { allowed: false, reason: "The authorisation was cancelled." };
    if (!live) return { allowed: false, reason: `Nothing to capture while the order is ${state}.` };
    if (ledger.cancelPending) {
      return { allowed: false, waiting: true, reason: "Waiting for the CANCELLATION webhook." };
    }
    if (ledger.capturePending > 0) {
      return { allowed: false, waiting: true, reason: "Waiting for the CAPTURE webhook." };
    }
    if (capturable === 0) return { allowed: false, reason: "The full amount is captured." };
    if (captured > 0 && !capabilities.multiplePartialCaptures) {
      return {
        allowed: false,
        reason: `${name} takes one partial capture: Adyen cancelled the rest after the first.`,
      };
    }
    return {
      allowed: true,
      maxValue: capturable,
      partial: capabilities.partialCapture,
      reason: captured > 0
        ? "Another partial capture. It needs multiple partial captures enabled on the merchant account; without it, Adyen cancelled the rest after the first capture."
        : capabilities.partialCapture
        ? "Capture all of it, or part of it."
        : `${name} is captured in full only.`,
    };
  })();

  const cancel = (() => {
    if (!capabilities.separateCapture || capabilities.automaticCapture) {
      return { allowed: false, reason: `${name} is captured on authorisation: refund it instead.` };
    }
    if (ledger.cancelled) {
      return { allowed: false, reason: "The authorisation is already cancelled." };
    }
    if (!live) return { allowed: false, reason: `Nothing to cancel while the order is ${state}.` };
    if (ledger.cancelPending) {
      return { allowed: false, waiting: true, reason: "Waiting for the CANCELLATION webhook." };
    }
    if (captured > 0 || ledger.capturePending > 0) {
      return {
        allowed: false,
        reason: "Part of it is captured or being captured: refund instead.",
      };
    }
    return { allowed: true, reason: "Releases the authorisation; nothing is charged." };
  })();

  const refund = (() => {
    if (!capabilities.refund) return { allowed: false, reason: `${name} cannot be refunded.` };
    if (ledger.refundPending > 0) {
      return { allowed: false, waiting: true, reason: "Waiting for the REFUND webhook." };
    }
    if (captured === 0) {
      return ledger.capturePending > 0
        ? {
          allowed: false,
          reason: "Waiting for the CAPTURE webhook before anything can be refunded.",
        }
        : { allowed: false, reason: "Only captured payments can be refunded." };
    }
    if (refundable === 0) return { allowed: false, reason: "Everything captured is refunded." };
    if (ledger.refunded > 0 && !capabilities.multiplePartialRefunds) {
      return { allowed: false, reason: `${name} takes one refund only.` };
    }
    return {
      allowed: true,
      maxValue: refundable,
      partial: capabilities.partialRefund,
      reason: capabilities.partialRefund
        ? "Refund all of what is captured, or part of it."
        : `${name} is refunded in full only.`,
    };
  })();

  return { capture, cancel, refund };
}

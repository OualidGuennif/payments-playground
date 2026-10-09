import type { AttemptState, OrderState } from "./types.ts";

export interface AttemptSnapshot {
  id: string;
  state: AttemptState;
  value: number;
  pspReference?: string;
}

export interface OrderResolutionInput {
  currentState: OrderState;
  totalValue: number;
  expiresAt?: string;
  linkStatus?: "active" | "expired" | "completed" | "paymentPending";
  orderClosedWebhook?: { success: boolean };
  // A successful CAPTURE or CANCELLATION webhook. Only these settle a card
  // payment one way or the other; an authorisation alone never does.
  modificationWebhook?: { kind: "capture" | "cancel"; success: boolean };
  attempts: AttemptSnapshot[];
}

// Reached only through an authoritative event (ORDER_CLOSED, a completed
// link, a confirmed capture or cancellation), so nothing later reopens them:
// a REFUND webhook arriving after the capture must leave the order paid.
const SETTLED_STATES: ReadonlySet<OrderState> = new Set(["paid", "cancelled"]);

export interface OrderResolution {
  state: OrderState;
  paidValue: number;
  terminal: boolean;
  reason: string;
}

export function mapAdyenResultCode(resultCode: string | undefined): AttemptState {
  switch ((resultCode ?? "").toLowerCase()) {
    case "authorised":
    case "received":
      return resultCode?.toLowerCase() === "authorised" ? "authorised" : "pending";
    case "pending":
    case "presenttoshopper":
    case "redirectshopper":
    case "identifyshopper":
    case "challengeshopper":
      return "pending";
    case "refused":
      return "refused";
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
    default:
      return "created";
  }
}

export function resolveOrder(input: OrderResolutionInput, now = new Date()): OrderResolution {
  const successfulByReference = new Map<string, number>();
  for (const attempt of input.attempts) {
    if (attempt.state !== "authorised") continue;
    successfulByReference.set(attempt.pspReference ?? attempt.id, attempt.value);
  }
  const paidValue = [...successfulByReference.values()].reduce((sum, value) => sum + value, 0);

  if (SETTLED_STATES.has(input.currentState)) {
    return {
      state: input.currentState,
      paidValue,
      terminal: true,
      reason: "The order was already settled by an authoritative event.",
    };
  }

  if (input.modificationWebhook?.success) {
    return input.modificationWebhook.kind === "capture"
      ? {
        state: "paid",
        paidValue,
        terminal: true,
        reason: "CAPTURE success=true: the authorised amount is captured.",
      }
      : {
        state: "cancelled",
        paidValue,
        terminal: true,
        reason: "CANCELLATION success=true: the authorisation is released.",
      };
  }

  if (input.orderClosedWebhook) {
    return input.orderClosedWebhook.success
      ? {
        state: "paid",
        paidValue,
        terminal: true,
        reason: "ORDER_CLOSED success=true is the authoritative terminal event.",
      }
      : {
        state: "cancelled",
        paidValue,
        terminal: true,
        reason: "ORDER_CLOSED success=false closed the partial payment order.",
      };
  }

  if (input.linkStatus === "completed" && paidValue >= input.totalValue) {
    return {
      state: "paid",
      paidValue,
      terminal: true,
      reason: "The payment link is completed and the full amount is authorised.",
    };
  }

  const expiredByDate = input.expiresAt
    ? new Date(input.expiresAt).getTime() <= now.getTime()
    : false;
  if (input.linkStatus === "expired" || expiredByDate) {
    return {
      state: "expired",
      paidValue,
      terminal: true,
      reason: "The effective link/order validity elapsed; no further attempt is possible.",
    };
  }

  if (paidValue > 0 && paidValue < input.totalValue) {
    return {
      state: "partially_paid",
      paidValue,
      terminal: false,
      reason: "A balance remains and a subsequent tender is still allowed.",
    };
  }

  if (paidValue >= input.totalValue) {
    return {
      state: "payment_pending",
      paidValue,
      terminal: false,
      reason: "Full amount is authorised; waiting for the authoritative closing webhook.",
    };
  }

  if (input.attempts.some((attempt) => attempt.state === "pending")) {
    return {
      state: "payment_pending",
      paidValue,
      terminal: false,
      reason: "At least one attempt is still pending.",
    };
  }

  return {
    state: "open",
    paidValue,
    terminal: false,
    reason:
      "A refusal is attempt-level only. The order remains open while its link/order is valid.",
  };
}

// Spec: knowledge/components/adyen-digital.md
// When a Sessions order may get a new session: decided from what the server knows, never from
// what the browser says (ADR-022).
import type { OrderState, PaymentSessionAggregate } from "@suite/platform/types.ts";

// Adyen takes five refused payments in one session; the sixth answers 422 "14_0422" (seen on
// TEST, 2026-10-16).
export const SESSION_REFUSAL_LIMIT = 5;

export type RenewalDecision =
  | { kind: "refuse"; error: string }
  | { kind: "wait"; refusals: number }
  | { kind: "renew"; refusals: number };

const NOT_RENEWED: Record<Exclude<OrderState, "open">, string> = {
  payment_pending: "A payment of this order is authorised or still pending.",
  partially_paid: "This order is part paid; start a new checkout.",
  paid: "This order is paid.",
  cancelled: "This order is cancelled.",
  expired: "This order expired; start a new checkout.",
  failed: "This order failed; start a new checkout.",
};

/**
 * `refusals` counts the HMAC-valid refusal webhooks that name the current session. Anything
 * missing or uncertain refuses or waits: a session is only renewed once Adyen has said five times
 * that this one refused.
 */
export function renewalDecision(input: {
  flow: string;
  orderState: OrderState;
  sameProfile: boolean;
  session?: Pick<PaymentSessionAggregate, "state" | "adyenSessionId">;
  refusals: number;
}): RenewalDecision {
  if (!input.flow.startsWith("sessions")) {
    return { kind: "refuse", error: "Only a Sessions order gets a new session." };
  }
  if (!input.sameProfile) {
    return { kind: "refuse", error: "This order was made under another profile." };
  }
  if (input.orderState !== "open") {
    return { kind: "refuse", error: NOT_RENEWED[input.orderState] };
  }
  const session = input.session;
  if (!session?.adyenSessionId) {
    return { kind: "refuse", error: "This order has no session to renew." };
  }
  // Another request holds the claim: its session is on its way.
  if (session.state === "renewing") return { kind: "wait", refusals: input.refusals };
  if (session.state !== "created") {
    return { kind: "refuse", error: "This order's session was already replaced." };
  }
  if (input.refusals < SESSION_REFUSAL_LIMIT) return { kind: "wait", refusals: input.refusals };
  return { kind: "renew", refusals: input.refusals };
}

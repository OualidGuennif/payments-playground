// Spec: knowledge/components/adyen-agentic-commerce.md
// One payment at a time per checkout, whichever channel pays: the shopper's Drop-in claims the
// checkout before it submits, an agent's complete claims it by moving it to complete_in_progress.
// Each claim reads and writes in one synchronous step (bun:sqlite, one process), so two claims
// never both pass.
import { DEFAULT_DELIVERY } from "../../lib/delivery";
import { findBy, get, put } from "../core/db";
import { trace } from "../core/trace";
import {
  type Checkout,
  type Delivery,
  err,
  type Line,
  now,
  PAYING_MS,
  type PaymentRecord,
  paymentInProgress,
  payingNow,
} from "./model";
import { price } from "./pricing";
import { assess, saveCheckout } from "./checkouts";

// Adyen's answers after which a payment has paid, or may still pay (a Drop-in session reports
// `paymentPending`, a /payments answer `Pending` or `Received`).
const MAY_PAY = new Set(["Authorised", "Pending", "Received", "paymentPending"]);
export const mayPay = (resultCode: string | undefined) => MAY_PAY.has(resultCode ?? "");

/** Whether two bags hold the same variants in the same quantities, in the same order. */
export const sameLines = (a: Line[] | undefined, b: Line[]) =>
  a !== undefined &&
  a.length === b.length &&
  a.every((l, i) => l.variantId === b[i]?.variantId && l.quantity === b[i]?.quantity);

const sameDelivery = (a: Delivery, b: Delivery) => a.method === b.method && a.placeId === b.placeId;

/**
 * Whether the account is paying another checkout now: a Drop-in hold, or an agent's payment sent
 * within the hold's time. One account pays one checkout at a time, whichever channel and bag.
 */
export function accountPaying(customerId: string | undefined, exceptId: string, at = Date.now()) {
  if (!customerId) return false;
  const busy = (c: Checkout) =>
    c.id !== exceptId &&
    (payingNow(c, at) !== undefined ||
      (c.phase === "complete_in_progress" && Date.parse(c.updatedAt) + PAYING_MS > at));
  // The account's own checkouts, and any checkout its browser holds while signed in.
  return (
    findBy<Checkout>("checkouts", "customerId", customerId).some(busy) ||
    findBy<Checkout>("checkouts", "payerId", customerId).some(busy)
  );
}

/**
 * The shopper's Drop-in asks to pay with the session it was given. It may only when the checkout is
 * open, no other payment holds it, and the session was priced from the checkout as it stands: an
 * edit since then (in the Ask panel, by an agent) means the form shows an old bag.
 */
export function claimWebPayment(
  id: string,
  sessionId: string,
  at = Date.now(),
  viewerId?: string,
): Checkout {
  const checkout = get<Checkout>("checkouts", id);
  if (!checkout) throw err(404, "not_found", "Checkout not found");
  const record = findBy<PaymentRecord>("payments", "sessionId", sessionId).find(
    (p) => p.checkoutId === id && p.purpose === "shopper",
  );
  if (!record) throw err(404, "not_found", "Unknown payment session");
  const held = payingNow(checkout, at);
  if (
    checkout.phase !== "open" ||
    (held && held.reference !== record.reference) ||
    accountPaying(checkout.customerId, id, at) ||
    (viewerId !== checkout.customerId && accountPaying(viewerId, id, at))
  ) {
    trace({
      channel: "web",
      actor: "shopper",
      method: "POST",
      path: "/api/checkouts/:id/pay-intent",
      status: 409,
      ref: id,
      detail: { refused: "payment_in_progress", phase: checkout.phase },
    });
    throw paymentInProgress();
  }
  const status = assess({ ...checkout, paying: undefined }, undefined, []).status;
  if (
    record.reference !== `${id}-s${checkout.attempts}` ||
    record.amount !== price(checkout.lines, checkout.delivery, checkout.welcomeOffer).total ||
    !sameLines(record.lines, checkout.lines) ||
    status === "incomplete" ||
    status === "canceled"
  ) {
    throw err(
      409,
      "checkout_changed",
      "This checkout changed since the payment form opened",
      undefined,
      "requires_buyer_review",
    );
  }
  // Another address or pickup point at the same price keeps the form's session; the order then ships
  // where the shopper chose before paying, and the hold below stops any change after this.
  const chosen = checkout.delivery ?? DEFAULT_DELIVERY;
  if (!sameDelivery(record.delivery ?? DEFAULT_DELIVERY, chosen))
    put("payments", record.id, { ...record, delivery: chosen, updatedAt: now() });
  const until = new Date(at + PAYING_MS).toISOString();
  const payer = viewerId && viewerId !== checkout.customerId ? viewerId : undefined;
  return saveCheckout({
    ...checkout,
    paying: { channel: "web", reference: record.reference, until },
    // The same form claiming again (a retry) keeps the payer its first claim named, or names the
    // shopper who has signed in since.
    payerId: held ? (checkout.payerId ?? payer) : payer,
  });
}

/**
 * Whether a payment on this checkout other than this one may still pay it: an agent's call still
 * in flight, or any payment Adyen answered as authorised or pending. The checkout waits for it.
 * An agent's retry after a network error reuses its reference, which Adyen treats as one payment.
 */
export function anotherMayPay(checkout: Checkout, reference: string): boolean {
  return findBy<PaymentRecord>("payments", "checkoutId", checkout.id).some((p) => {
    if (p.reference === reference || p.purpose === "card-save") return false;
    if (p.resultCode === undefined) return p.purpose === "agent";
    return mayPay(p.resultCode);
  });
}

/**
 * Whether a refusal of this payment reopens the checkout: only one in progress, with no order or
 * held amount mismatch, and no other payment that may still pay it, so a checkout reopens only
 * when nothing of it may still be paid, whichever payment fails last.
 */
export function refusalReopens(checkout: Checkout, reference: string): boolean {
  return (
    checkout.phase === "complete_in_progress" &&
    !checkout.orderId &&
    checkout.lastMessage?.code !== "amount_mismatch" &&
    !anotherMayPay(checkout, reference)
  );
}

/** Frees a checkout held by this payment, and its payer; a hold by another payment stays. */
export function releasePayment(checkoutId: string, reference: string): void {
  const checkout = get<Checkout>("checkouts", checkoutId);
  if (checkout?.paying?.reference === reference)
    saveCheckout({ ...checkout, paying: undefined, payerId: undefined });
}

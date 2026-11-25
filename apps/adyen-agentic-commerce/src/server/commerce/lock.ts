// Spec: knowledge/components/adyen-agentic-commerce.md
// One payment at a time per checkout, whichever channel pays: the shopper's Drop-in claims the
// checkout before it submits, an agent's complete claims it by moving it to complete_in_progress.
// Each claim reads and writes in one synchronous step (bun:sqlite, one process), so two claims
// never both pass.
import { findBy, get } from "../core/db";
import { trace } from "../core/trace";
import {
  type Checkout,
  err,
  type Line,
  PAYING_MS,
  type PaymentRecord,
  paymentInProgress,
  payingNow,
} from "./model";
import { price } from "./pricing";
import { assess, saveCheckout } from "./checkouts";

const sameLines = (a: Line[] | undefined, b: Line[]) =>
  a !== undefined &&
  a.length === b.length &&
  a.every((l, i) => l.variantId === b[i]?.variantId && l.quantity === b[i]?.quantity);

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
    findBy<Checkout>("checkouts", "payerId", customerId).some(
      (c) => payingNow(c, at) !== undefined && busy(c),
    )
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
    record.amount !== price(checkout.lines).total ||
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
  const until = new Date(at + PAYING_MS).toISOString();
  return saveCheckout({
    ...checkout,
    paying: { channel: "web", reference: record.reference, until },
    payerId: viewerId && viewerId !== checkout.customerId ? viewerId : undefined,
  });
}

/** Frees a checkout held by this payment; a hold by another payment stays. */
export function releasePayment(checkoutId: string, reference: string): void {
  const checkout = get<Checkout>("checkouts", checkoutId);
  if (checkout?.paying?.reference === reference) saveCheckout({ ...checkout, paying: undefined });
}

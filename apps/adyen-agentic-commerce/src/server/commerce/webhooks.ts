// Spec: knowledge/components/adyen-agentic-commerce.md
// Adyen's HMAC-checked notifications, which settle payments and orders.
import { findBy, get, put } from "../core/db";
import * as adyen from "../payments/adyen";
import { type Checkout, now, type Order, type PaymentRecord } from "./model";
import { saveCheckout } from "./checkouts";
import { holdMismatch, holdReservation, placePaidOrder, releaseReservation } from "./payment";

export function applyNotification(item: adyen.NotificationItem): string {
  const reference = item.merchantReference ?? "";
  const record = findBy<PaymentRecord>("payments", "reference", reference)[0];
  if (!record) return "no matching payment";
  const success = item.success === "true";
  if (item.eventCode !== "AUTHORISATION") return "recorded";
  put("payments", record.id, {
    ...record,
    resultCode: success ? "Authorised" : "Refused",
    pspReference: item.pspReference ?? record.pspReference,
    refusalReason: success ? undefined : item.reason,
    updatedAt: now(),
  });
  if (!record.checkoutId) return "card save recorded";
  const checkout = get<Checkout>("checkouts", record.checkoutId);
  if (!checkout) return "checkout missing";
  const stamp = { eventCode: item.eventCode, success, at: now() };
  if (checkout.orderId) {
    const order = get<Order>("orders", checkout.orderId);
    if (order && order.pspReference === item.pspReference)
      put("orders", order.id, { ...order, webhook: stamp });
    return "order confirmed";
  }
  if (success) {
    if (record.purpose === "agent") holdReservation(record, checkout.grantId);
    const placed = placePaidOrder(checkout, record, item.pspReference, item.amount?.value);
    if (typeof placed === "string") {
      holdMismatch(checkout, placed);
      return "amount mismatch, no order";
    }
    put("orders", placed.id, { ...placed, webhook: stamp });
    return "order placed from webhook";
  }
  // Only a refusal of the attempt in progress reopens the checkout: a late refusal of an earlier
  // attempt must not reopen it while a newer one is pending, nor give back budget never reserved.
  const current = [`${checkout.id}-a${checkout.attempts}`, `${checkout.id}-s${checkout.attempts}`];
  // A refused Drop-in payment no longer holds the checkout; another payment's hold stays.
  const paying = checkout.paying?.reference === record.reference ? undefined : checkout.paying;
  if (checkout.phase === "complete_in_progress" && current.includes(record.reference)) {
    // The agent's budget was reserved when the payment was sent; a refusal gives it back once.
    if (record.purpose === "agent") releaseReservation(record, checkout.grantId);
    // The refused payment was the last one on this bag, so it has no payer any more.
    saveCheckout({
      ...checkout,
      paying,
      payerId: undefined,
      phase: "open",
      lastMessage: {
        type: "error",
        code: "payment_refused",
        content: `Adyen refused the payment${item.reason ? ` (${item.reason})` : ""}`,
        severity: "requires_buyer_review",
      },
    });
  } else if (paying !== checkout.paying) saveCheckout({ ...checkout, paying, payerId: undefined });
  return "refusal recorded";
}

// Spec: knowledge/components/adyen-agentic-commerce.md
// Adyen's HMAC-checked notifications, which settle payments and orders.
import { findBy, get, put } from "../core/db";
import type * as adyen from "../payments/adyen";
import { type Checkout, now, type Order, type PaymentRecord } from "./model";
import { saveCheckout } from "./checkouts";
import { mayPay, refusalReopens } from "./lock";
import { holdMismatch, holdReservation, placePaidOrder, releaseReservation } from "./payment";

export function applyNotification(item: adyen.NotificationItem): string {
  const reference = item.merchantReference ?? "";
  const record = findBy<PaymentRecord>("payments", "reference", reference)[0];
  if (!record) return "no matching payment";
  const success = item.success === "true";
  if (item.eventCode !== "AUTHORISATION") return "recorded";
  const settledBy = item.pspReference
    ? [...new Set([...(record.settledBy ?? []), item.pspReference])]
    : record.settledBy;
  // A refusal names one payment: when the record already follows another that has paid or may
  // still pay (a later card in the same form), it is a late refusal of an earlier attempt and
  // changes nothing but the list of settled payments.
  if (
    !success &&
    record.pspReference !== undefined &&
    record.pspReference !== item.pspReference &&
    mayPay(record.resultCode)
  ) {
    put("payments", record.id, { ...record, settledBy, updatedAt: now() });
    return "refusal of an earlier attempt";
  }
  put("payments", record.id, {
    ...record,
    settledBy,
    resultCode: success ? "Authorised" : "Refused",
    pspReference: item.pspReference ?? record.pspReference,
    refusalReason: success ? undefined : item.reason,
    updatedAt: now(),
  });
  if (!record.checkoutId) return "card save recorded";
  const checkout = get<Checkout>("checkouts", record.checkoutId);
  if (!checkout) return "checkout missing";
  const stamp = { eventCode: item.eventCode, success, at: now() };
  const order = checkout.orderId ? get<Order>("orders", checkout.orderId) : undefined;
  // A refused agent payment gives its budget back, and an authorised one whose reservation an
  // unknown outcome gave back charges it again, once each, even when another payment placed the
  // order meanwhile; the reservation is settled at most once whichever path learns first.
  if (record.purpose === "agent") {
    if (success) holdReservation(record, checkout.grantId);
    else if (!order || order.pspReference !== item.pspReference)
      releaseReservation(record, checkout.grantId);
  }
  if (checkout.orderId) {
    if (order && order.pspReference === item.pspReference)
      put("orders", order.id, { ...order, webhook: stamp });
    return "order confirmed";
  }
  if (success) {
    // A held amount mismatch waits for a person: no payment turns it into an order.
    if (checkout.lastMessage?.code === "amount_mismatch") return "amount mismatch held, no order";
    const placed = placePaidOrder(checkout, record, item.pspReference, item.amount?.value);
    if (typeof placed === "string") {
      holdMismatch(checkout, placed);
      return "amount mismatch, no order";
    }
    put("orders", placed.id, { ...placed, webhook: stamp });
    return "order placed from webhook";
  }
  // A refused Drop-in payment no longer holds the checkout; another payment's hold stays.
  const paying = checkout.paying?.reference === record.reference ? undefined : checkout.paying;
  if (refusalReopens(checkout, record.reference)) {
    // The payer goes with the refused payment; another tab's form still holding the checkout
    // keeps its own.
    saveCheckout({
      ...checkout,
      paying,
      payerId: paying ? checkout.payerId : undefined,
      phase: "open",
      lastMessage: {
        type: "error",
        code: "payment_refused",
        content: `Adyen refused the payment${item.reason ? ` (${item.reason})` : ""}`,
        severity: "requires_buyer_review",
      },
    });
  } else if (paying !== checkout.paying) {
    saveCheckout({ ...checkout, paying, payerId: undefined });
  }
  return "refusal recorded";
}

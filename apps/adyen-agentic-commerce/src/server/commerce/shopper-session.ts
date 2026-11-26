// Spec: knowledge/components/adyen-agentic-commerce.md
// The shopper's browser: a Sessions payment for a checkout, and saving a card from the account
// page.
import { config, CURRENCY } from "../core/config";
import type { Customer } from "../accounts/customers";
import { findBy, get, put } from "../core/db";
import { trace } from "../core/trace";
import { newId } from "../core/util";
import * as adyen from "../payments/adyen";
import { type Checkout, err, now, type PaymentRecord, paymentInProgress } from "./model";
import { forgetCardCache } from "./saved-cards";
import { assess, buyerOf, loadCheckout, saveCheckout } from "./checkouts";
import { releasePayment } from "./lock";
import { holdMismatch, placePaidOrder } from "./payment";

// Saved cards show in Drop-in only for the checkout's own signed-in account; anyone else, guest or
// another account, pays as a guest. A checkout no account holds yet becomes the payer's.
export async function startShopperSession(loaded: Checkout, customer?: Customer) {
  const owner = customer && (!loaded.customerId || loaded.customerId === customer.id);
  const checkout = owner && !loaded.customerId ? { ...loaded, customerId: customer.id } : loaded;
  const assessment = assess(checkout, undefined, []);
  if (
    checkout.phase !== "open" ||
    assessment.status === "incomplete" ||
    assessment.status === "canceled"
  ) {
    throw err(
      409,
      "checkout_not_payable",
      "This checkout cannot be paid now",
      undefined,
      "requires_buyer_input",
    );
  }
  // Another tab's Drop-in holds the checkout: a new session would start a new attempt, so that
  // payment's refusal would read as stale and its retry as a changed bag.
  if (assessment.status === "complete_in_progress") throw paymentInProgress();
  const attempt = checkout.attempts + 1;
  saveCheckout({ ...checkout, attempts: attempt });
  const reference = `${checkout.id}-s${attempt}`;
  const session = await adyen.createSession({
    amount: assessment.total,
    reference,
    returnUrl: `${config().publicOrigin}/api/return?to=${encodeURIComponent(`/checkout/${checkout.id}`)}&ref=${encodeURIComponent(reference)}`,
    shopperEmail: buyerOf(checkout)?.email ?? (owner ? customer.email : undefined),
    shopperReference: owner ? customer.id : undefined,
    purpose: "order",
    metadata: { checkoutId: checkout.id, channel: "web" },
  });
  put<PaymentRecord>("payments", reference, {
    id: reference,
    purpose: "shopper",
    channel: "web",
    checkoutId: checkout.id,
    reference,
    amount: assessment.total,
    lines: checkout.lines,
    sessionId: session.id,
    createdAt: now(),
    updatedAt: now(),
  });
  trace({
    channel: "adyen",
    actor: "shopper",
    method: "POST",
    path: "/sessions",
    status: 200,
    ref: checkout.id,
    detail: { reference, amount: assessment.total },
  });
  return {
    ...session,
    clientKey: config().adyen.clientKey!,
    amount: assessment.total,
    currency: CURRENCY,
    storedCards: Boolean(owner),
  };
}

export async function finishShopperSession(
  loaded: Checkout,
  sessionId: string,
  sessionResult: string,
) {
  const known = findBy<PaymentRecord>("payments", "sessionId", sessionId).find(
    (p) => p.checkoutId === loaded.id,
  );
  if (!known) throw err(404, "not_found", "Unknown payment session");
  const result = await adyen.sessionResult(sessionId, sessionResult);
  // Re-read after the await: a second result call or the webhook may have placed the order meanwhile.
  const checkout = get<Checkout>("checkouts", loaded.id) ?? loaded;
  const record = get<PaymentRecord>("payments", known.id) ?? known;
  const authorised = result.payments.find((p) => p.resultCode === "Authorised");
  put("payments", record.id, {
    ...record,
    resultCode: authorised ? "Authorised" : result.status,
    pspReference: authorised?.pspReference ?? result.payments[0]?.pspReference,
    updatedAt: now(),
  });
  trace({
    channel: "adyen",
    actor: "shopper",
    method: "GET",
    path: "/sessions/{id}",
    status: 200,
    ref: checkout.id,
    detail: result,
  });
  if (checkout.phase === "completed") return checkout;
  if (result.status === "completed" && authorised) {
    const placed = placePaidOrder(checkout, record, authorised.pspReference, authorised.amount);
    if (typeof placed === "string") holdMismatch(checkout, placed);
  } else if (result.status === "paymentPending") {
    saveCheckout({ ...checkout, phase: "complete_in_progress", paying: undefined });
  } else if (
    checkout.phase === "complete_in_progress" &&
    record.reference === `${checkout.id}-s${checkout.attempts}`
  ) {
    // This attempt's pending payment failed after all: Adyen's answer reopens the checkout as its
    // refusal webhook would, which a local run never receives.
    saveCheckout({
      ...checkout,
      phase: "open",
      payerId: undefined,
      lastMessage: {
        type: "error",
        code: "payment_refused",
        content: "Adyen refused the payment",
        severity: "requires_buyer_review",
      },
    });
  } else {
    // Refused, canceled or expired: this payment no longer holds the checkout.
    releasePayment(checkout.id, record.reference);
  }
  return loadCheckout(checkout.id, "browser");
}

export async function startCardSave(customer: Customer) {
  const reference = newId("cardsave");
  const session = await adyen.createSession({
    amount: 0,
    reference,
    returnUrl: `${config().publicOrigin}/api/return?to=${encodeURIComponent("/account")}&ref=${encodeURIComponent(reference)}`,
    purpose: "card-save",
    shopperEmail: customer.email,
    shopperReference: customer.id,
    metadata: { purpose: "card-save", channel: "web" },
  });
  put<PaymentRecord>("payments", reference, {
    id: reference,
    purpose: "card-save",
    channel: "web",
    customerId: customer.id,
    reference,
    amount: 0,
    sessionId: session.id,
    createdAt: now(),
    updatedAt: now(),
  });
  trace({
    channel: "adyen",
    actor: "shopper",
    method: "POST",
    path: "/sessions",
    status: 200,
    ref: reference,
    detail: {
      reference,
      amount: 0,
      storePaymentMethodMode: "enabled",
      recurringProcessingModel: "UnscheduledCardOnFile",
    },
  });
  return { ...session, clientKey: config().adyen.clientKey!, amount: 0, currency: CURRENCY };
}

export function sessionIdForReference(
  reference: string | undefined,
  scope: { customerId?: string; checkoutId?: string },
): string | undefined {
  if (!reference) return undefined;
  const record = get<PaymentRecord>("payments", reference);
  if (!record?.sessionId) return undefined;
  if (scope.customerId !== undefined)
    return record.purpose === "card-save" && record.customerId === scope.customerId
      ? record.sessionId
      : undefined;
  if (scope.checkoutId !== undefined)
    return record.checkoutId === scope.checkoutId ? record.sessionId : undefined;
  return undefined;
}

export async function finishCardSave(customer: Customer, sessionId: string, sessionResult: string) {
  const record = findBy<PaymentRecord>("payments", "sessionId", sessionId).find(
    (p) => p.purpose === "card-save" && p.customerId === customer.id,
  );
  if (!record) throw err(404, "not_found", "Unknown card session");
  const result = await adyen.sessionResult(sessionId, sessionResult);
  put("payments", record.id, {
    ...record,
    resultCode: result.payments[0]?.resultCode ?? result.status,
    pspReference: result.payments[0]?.pspReference,
    updatedAt: now(),
  });
  forgetCardCache(customer.id);
  return result.status;
}

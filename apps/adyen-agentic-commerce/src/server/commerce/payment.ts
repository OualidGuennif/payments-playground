// Spec: knowledge/components/adyen-agentic-commerce.md
// Completing a checkout: the payment instrument, the grant's budget, Adyen's answer and the order
// it places.
import { variantById } from "../catalog/catalog";
import { DEFAULT_DELIVERY, type Delivery } from "../../lib/delivery";
import { CURRENCY } from "../core/config";
import { customerById } from "../accounts/customers";
import { findBy, get, put } from "../core/db";
import { credentialFingerprint } from "../core/fingerprint";
import { allows, type Auth, chargeGrant, liveAuth } from "../oauth/oauth";
import { trace } from "../core/trace";
import { isRecord, newId } from "../core/util";
import * as adyen from "../payments/adyen";
import {
  type Checkout,
  err,
  type Line,
  now,
  type Order,
  type OrderLine,
  type PaymentRecord,
  type WelcomeOffer,
  paymentInProgress,
} from "./model";
import { accountPaying, refusalReopens, sameLines } from "./lock";
import { price } from "./pricing";
import { savedCards } from "./saved-cards";
import { assess, buyerOf, confirmWelcomeOffer, loadCheckout, saveCheckout } from "./checkouts";

function snapshot(lines: Line[]): OrderLine[] {
  return lines.map((l) => {
    const v = variantById(l.variantId)!;
    return { variantId: v.id, title: v.title, quantity: l.quantity, unitPrice: v.price };
  });
}

function placeOrder(
  checkout: Checkout,
  paidBy: Order["paidBy"],
  pspReference: string | undefined,
  status: Order["status"],
  paidLines: Line[],
  delivery: Delivery,
  welcomeOffer: WelcomeOffer | undefined,
): Order {
  const p = price(paidLines, delivery, welcomeOffer);
  const order: Order = {
    id: newId("ord"),
    checkoutId: checkout.id,
    lines: snapshot(paidLines),
    subtotal: p.subtotal,
    discount: p.discount || undefined,
    fulfillment: p.fulfillment,
    total: p.total,
    currency: CURRENCY,
    buyer: buyerOf(checkout),
    delivery,
    welcomeOffer,
    status,
    channel: checkout.channel,
    customerId: checkout.customerId,
    clientId: checkout.clientId,
    paidBy,
    agentName: paidBy === "agent" ? checkout.agentName : undefined,
    pspReference,
    createdAt: now(),
  };
  put("orders", order.id, order);
  saveCheckout({
    ...checkout,
    phase: "completed",
    orderId: order.id,
    lastMessage: undefined,
    paying: undefined,
  });
  return order;
}

/**
 * Gives an agent payment's reservation back, once: the synchronous answer and the webhook can both
 * report a refusal, and only the first gives the budget back. It goes to the grant the payment was
 * reserved on; `grantId` (the checkout's) serves only a record that does not name one.
 */
export function releaseReservation(
  record: PaymentRecord,
  grantId: string | undefined,
): PaymentRecord {
  const fresh = get<PaymentRecord>("payments", record.id) ?? record;
  const grant = fresh.grantId ?? grantId;
  if (fresh.reservation !== "held" || !grant) return fresh;
  chargeGrant(grant, -fresh.amount);
  return put("payments", fresh.id, { ...fresh, reservation: "released", updatedAt: now() });
}

/**
 * Charges an agent payment Adyen authorised whose reservation was given back on an unknown outcome
 * (a network error after Adyen had already authorised it), so the budget counts every payment.
 */
export function holdReservation(record: PaymentRecord, grantId: string | undefined): void {
  const fresh = get<PaymentRecord>("payments", record.id) ?? record;
  const grant = fresh.grantId ?? grantId;
  if (fresh.reservation !== "released" || !grant) return;
  chargeGrant(grant, fresh.amount);
  put("payments", fresh.id, { ...fresh, reservation: "held", updatedAt: now() });
}

/**
 * The order for a payment Adyen authorised, or why none is placed. The lines come from the payment
 * record, and the amount Adyen reports, when it reports one, must be the amount that was sent.
 */
export function placePaidOrder(
  checkout: Checkout,
  record: PaymentRecord,
  pspReference: string | undefined,
  reportedAmount: number | undefined,
): Order | string {
  const lines = record.lines ?? checkout.lines;
  // A record without a delivery (made before any choice, or before delivery choices existed) was
  // priced as the default; never the checkout's choice made after the payment was sent.
  const delivery = (record.lines ? record.delivery : checkout.delivery) ?? DEFAULT_DELIVERY;
  // The offer the amount was priced with, like the delivery: never one granted or lost after.
  const welcomeOffer = record.lines ? record.welcomeOffer : checkout.welcomeOffer;
  if (reportedAmount !== undefined && reportedAmount !== record.amount)
    return `Adyen authorised ${reportedAmount}, the payment was sent for ${record.amount}`;
  const total = price(lines, delivery, welcomeOffer).total;
  if (total !== record.amount)
    return `The lines total ${total}, the payment was sent for ${record.amount}`;
  const paidBy = record.purpose === "agent" ? "agent" : "shopper";
  return placeOrder(checkout, paidBy, pspReference, "authorised", lines, delivery, welcomeOffer);
}

/**
 * No order: the amounts disagree. The checkout is held in progress, so neither the agent nor the
 * shopper can pay it again or edit it, and it says why; nothing reads as paid.
 */
export function holdMismatch(checkout: Checkout, reason: string): void {
  trace({
    channel: "adyen",
    actor: "server",
    method: "POST",
    path: "/payments",
    status: 409,
    ref: checkout.id,
    detail: { amountMismatch: reason },
  });
  saveCheckout({
    ...checkout,
    phase: "complete_in_progress",
    paying: undefined,
    lastMessage: {
      type: "error",
      code: "amount_mismatch",
      content: `No order was placed: ${reason}. Check the payment in the Back Office.`,
      severity: "requires_buyer_review",
    },
  });
}

export type NetworkToken = Omit<adyen.NetworkTokenPayment["token"], "brand">;
export type Instrument =
  | { handler: "saved_card"; alias: string }
  | { handler: "network_token"; token: NetworkToken; lastFour: string };

const bad = (path: string, content: string) =>
  err(400, "invalid_credential", content, `$.payment.instruments[0].credential.${path}`);

// The agent's network token: its number and expiry, checked field by field (owner decision
// 2026-11-17: no cryptogram, no CVC, no brand). Other fields are ignored; nothing is echoed back.
function networkToken(credential: unknown): Instrument {
  if (!isRecord(credential) || credential.type !== "network_token")
    throw err(
      400,
      "invalid_credential",
      "A network_token instrument needs a credential of type network_token",
      "$.payment.instruments[0].credential",
    );
  const { number, expiry_month, expiry_year, name } = credential;
  if (typeof number !== "string" || !/^\d{13,19}$/.test(number))
    throw bad("number", "number must be the 13 to 19 digits of the network token");
  if (
    typeof expiry_month !== "number" ||
    !Number.isInteger(expiry_month) ||
    expiry_month < 1 ||
    expiry_month > 12
  )
    throw bad("expiry_month", "expiry_month must be an integer from 1 to 12");
  const today = new Date();
  if (
    typeof expiry_year !== "number" ||
    !Number.isInteger(expiry_year) ||
    expiry_year > 9999 ||
    expiry_year < today.getUTCFullYear() ||
    (expiry_year === today.getUTCFullYear() && expiry_month < today.getUTCMonth() + 1)
  )
    throw bad("expiry_year", "The token has expired or expiry_year is not a four-digit year");
  return {
    handler: "network_token",
    lastFour: number.slice(-4),
    token: {
      number,
      expiryMonth: String(expiry_month).padStart(2, "0"),
      expiryYear: String(expiry_year),
      holderName: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : undefined,
    },
  };
}

// The brand is Adyen's answer or nothing: an unknown number is the agent's to fix, and a failed
// lookup pays nothing and leaves the checkout as it was.
async function networkTokenBrand(number: string, ref: string): Promise<string> {
  let brand: string | undefined;
  try {
    brand = await adyen.cardBrand(number);
  } catch (error) {
    trace({
      channel: "adyen",
      actor: "server",
      method: "POST",
      path: "/cardDetails",
      status: 502,
      ref,
      // Any run of digits is masked: an error text must never carry the number back.
      detail: { error: (error as Error).message.replace(/\d{6,}/g, "…").slice(0, 200) },
    });
    throw err(
      502,
      "payment_unavailable",
      "The card brand could not be read; retry complete with the same body.",
      undefined,
      "recoverable",
    );
  }
  if (!brand) throw bad("number", "Adyen recognises no card brand for this number");
  return brand;
}

const unknownInstrument = () =>
  err(
    400,
    "unknown_instrument",
    "Pass one of the instruments listed in checkout.payment.instruments, a network token, or none",
    "$.payment.instruments",
  );

export function chosenInstrument(body: Record<string, unknown>): Instrument | undefined {
  const payment = isRecord(body.payment) ? body.payment : undefined;
  const instruments = Array.isArray(payment?.instruments) ? payment.instruments : [];
  // Only an empty list is "no instrument", which hands the checkout to the shopper; anything sent
  // that names no usable instrument is a 400 and changes nothing.
  if (!instruments.length) return undefined;
  const chosen = instruments.find((i) => isRecord(i) && i.selected === true) ?? instruments[0];
  if (!isRecord(chosen)) throw unknownInstrument();
  if (chosen.handler_id === "network_token") return networkToken(chosen.credential);
  if (chosen.handler_id !== undefined && chosen.handler_id !== "saved_card") {
    throw err(
      400,
      "unsupported_handler",
      "Use the saved_card or the network_token handler",
      "$.payment.instruments[0].handler_id",
    );
  }
  const credential = isRecord(chosen.credential) ? chosen.credential : undefined;
  const alias =
    typeof credential?.token === "string"
      ? credential.token
      : typeof chosen.id === "string"
        ? chosen.id
        : undefined;
  if (!alias) throw unknownInstrument();
  return { handler: "saved_card", alias };
}

// An agent's payment that failed may reopen the checkout only if its claim still stands: while
// the call was in flight a webhook may have placed an order or held an amount mismatch (a Drop-in
// payment that skipped the hold), or refused it and let the shopper's Drop-in claim a newer attempt,
// or Adyen may have left a Drop-in payment pending, which the checkout then waits for.
function stillClaimed(id: string, attempt: number): Checkout | undefined {
  const current = get<Checkout>("checkouts", id);
  return current?.attempts === attempt && refusalReopens(current, `${id}-a${attempt}`)
    ? current
    : undefined;
}

export async function completeCheckout(
  loaded: Checkout,
  body: Record<string, unknown>,
  auth?: Auth,
): Promise<Checkout> {
  // Checked before anything changes: a bad credential is a 400 and the checkout stays as it was.
  const instrument = chosenInstrument(body);
  const reference = auth ? customerById(auth.grant.customerId)?.id : undefined;
  const canUseCards = auth !== undefined && allows(auth.token.scopes, "ucp:pay");
  const cards = canUseCards ? await savedCards(reference) : [];
  // Adyen reads the token's brand, asked only when the checkout could be paid now: a checkout over
  // the limit or not ready sends the number nowhere.
  const brand =
    instrument?.handler === "network_token" &&
    assess(loaded, auth, []).status === "ready_for_complete"
      ? await networkTokenBrand(instrument.token.number, loaded.id)
      : undefined;
  // Re-read after the awaits: from here to the claim nothing yields, so a parallel complete that
  // claimed the checkout meanwhile is seen and no second payment is sent.
  const checkout = get<Checkout>("checkouts", loaded.id) ?? loaded;
  if (checkout.phase === "completed" || checkout.phase === "complete_in_progress") return checkout;
  if (checkout.phase === "canceled")
    throw err(409, "checkout_canceled", "This checkout was canceled");
  // The grant as it stands now, not as the token found it: a complete on another checkout may have
  // reserved part of the budget during the await above, or the shopper may have revoked it.
  const live = liveAuth(auth);
  if (auth && !live) return checkout;
  // The shopper is paying another checkout of the account (in Drop-in, or through another agent).
  if (live && accountPaying(live.grant.customerId, checkout.id)) throw paymentInProgress();
  confirmWelcomeOffer(checkout);
  const assessment = assess(checkout, live, cards);
  if (assessment.status !== "ready_for_complete") return checkout;
  // No instrument is the agent's third choice: the shopper pays at continue_url, in Drop-in.
  if (!instrument) return saveCheckout({ ...checkout, handedOverAt: now() });
  // Ready now but not when the brand was asked (an edit, or budget given back meanwhile): the
  // checkout is answered as it stands and the same complete can be sent again.
  if (instrument.handler === "network_token" && !brand) return checkout;
  const card =
    instrument.handler === "saved_card"
      ? cards.find((c) => c.alias === instrument.alias)
      : undefined;
  if (instrument.handler === "saved_card" && (!card || !reference)) throw unknownInstrument();

  // Claimed and the budget reserved synchronously before the network call, so a parallel complete
  // sees the checkout in progress and the grant already charged; a refusal or an error gives it back.
  // A retry after a network error resends the same payment under the same idempotency key, but
  // only while its outcome is unknown and for the same bag and card: a payment a webhook refused
  // since, or another bag or card, is a new attempt, and the earlier payment keeps its own record.
  const lastFour = instrument.handler === "network_token" ? instrument.lastFour : card?.lastFour;
  const instrumentKey =
    instrument.handler === "saved_card"
      ? `card:${instrument.alias}`
      : `token:${credentialFingerprint({
          number: instrument.token.number,
          expiryMonth: instrument.token.expiryMonth,
          expiryYear: instrument.token.expiryYear,
        })}`;
  const resent = (p: PaymentRecord | undefined) =>
    p?.purpose === "agent" &&
    p.resultCode === "Error" &&
    p.outcomeUnknown === true &&
    p.amount === assessment.total &&
    sameLines(p.lines, checkout.lines) &&
    p.instrumentKey === instrumentKey;
  const recordOf = (n: number) =>
    findBy<PaymentRecord>("payments", "reference", `${checkout.id}-a${n}`)[0];
  // The latest attempt may be the unknown one when a pending Drop-in payment kept the checkout
  // from reopening after the error, so its number was never given back.
  let attempt = resent(recordOf(checkout.attempts)) ? checkout.attempts : checkout.attempts + 1;
  while (recordOf(attempt) && !resent(recordOf(attempt))) attempt += 1;
  const prior = recordOf(attempt);
  // The agent's payment is not the browser's: an earlier Drop-in payer no longer pays this bag.
  const claimed = saveCheckout({
    ...checkout,
    payerId: undefined,
    phase: "complete_in_progress",
    attempts: attempt,
    channel: checkout.channel ?? "agent",
    ...(live
      ? {
          grantId: live.grant.id,
          agentName: live.grant.clientName,
          clientId: live.token.clientId,
          customerId: live.grant.customerId,
        }
      : { agentName: checkout.agentName ?? "Guest agent" }),
  });
  if (live) chargeGrant(live.grant.id, assessment.total);
  const grantId = live?.grant.id;
  const agentName = claimed.agentName ?? "Guest agent";
  const paymentReference = `${checkout.id}-a${attempt}`;
  const record: PaymentRecord = {
    id: prior?.id ?? newId("pay"),
    purpose: "agent",
    channel: "agent",
    instrument: instrument.handler,
    lastFour,
    instrumentKey,
    checkoutId: checkout.id,
    reference: paymentReference,
    amount: assessment.total,
    lines: checkout.lines,
    delivery: checkout.delivery,
    welcomeOffer: checkout.welcomeOffer,
    reservation: live ? "held" : undefined,
    grantId,
    agentName,
    createdAt: prior?.createdAt ?? now(),
    updatedAt: now(),
  };
  put("payments", record.id, record);
  const common = {
    amount: assessment.total,
    reference: paymentReference,
    idempotencyKey: `agent-pay-${paymentReference}`,
    shopperEmail: buyerOf(claimed)?.email,
    metadata: { checkoutId: checkout.id, channel: "agent", agent: agentName.slice(0, 80) },
  };
  let result: Awaited<ReturnType<typeof adyen.payWithSavedCard>>;
  try {
    result =
      instrument.handler === "network_token"
        ? await adyen.payWithNetworkToken({
            ...common,
            token: { ...instrument.token, brand: brand! },
          })
        : await adyen.payWithSavedCard({
            ...common,
            storedPaymentMethodId: card!.storedPaymentMethodId,
            shopperReference: reference!,
          });
  } catch (error) {
    // A success webhook can arrive while the call is in flight and then the call time out: the
    // payment is Authorised and the webhook settled it, so nothing here may undo that.
    if (get<PaymentRecord>("payments", record.id)?.resultCode === "Authorised") {
      return loadCheckout(checkout.id, "browser");
    }
    // The retry reserves again under the same reference; if Adyen did authorise this call, its
    // webhook charges the budget again before the order is placed. A refusal webhook that landed
    // during the call stands, so the next complete is a new attempt.
    const released = releaseReservation(record, grantId);
    put("payments", record.id, {
      ...released,
      resultCode: released.resultCode === "Refused" ? "Refused" : "Error",
      outcomeUnknown: released.resultCode !== "Refused",
      refusalReason:
        released.resultCode === "Refused"
          ? released.refusalReason
          : (error as Error).message.slice(0, 200),
      updatedAt: now(),
    });
    trace({
      channel: "adyen",
      actor: "server",
      method: "POST",
      path: "/payments",
      status: 502,
      ref: checkout.id,
      detail: { reference: paymentReference, error: (error as Error).message },
    });
    const current = stillClaimed(checkout.id, attempt);
    if (!current) return loadCheckout(checkout.id, "browser");
    return saveCheckout({
      ...current,
      phase: "open",
      attempts: checkout.attempts,
      lastMessage: {
        type: "error",
        code: "payment_unavailable",
        content: "The payment could not be sent; retry complete with the same body.",
        severity: "recoverable",
      },
    });
  }
  // Re-read: a webhook may have settled this payment while the call was in flight, and its
  // answer stands over this one (a pending answer must not make a refused payment pending again).
  const stored = get<PaymentRecord>("payments", record.id) ?? record;
  const answered = put("payments", record.id, {
    ...stored,
    ...result,
    resultCode: stored.resultCode ?? result.resultCode,
    updatedAt: now(),
  });
  trace({
    channel: "adyen",
    actor: "server",
    method: "POST",
    path: "/payments",
    status: 200,
    ref: checkout.id,
    detail: {
      reference: paymentReference,
      amount: assessment.total,
      instrument: instrument.handler,
      lastFour: record.lastFour,
      ...(instrument.handler === "network_token" ? { paymentMethod: "networkToken", brand } : {}),
      shopperInteraction: "ContAuth",
      recurringProcessingModel: "UnscheduledCardOnFile",
      ...result,
    },
  });
  // The answer that stands: a webhook's, when one came first.
  const code = answered.resultCode;
  if (code === "Authorised") {
    // The webhook may have placed the order, or held a mismatch, while the call was in flight.
    const current = get<Checkout>("checkouts", checkout.id) ?? claimed;
    if (!current.orderId && current.lastMessage?.code !== "amount_mismatch") {
      holdReservation(answered, grantId);
      const placed = placePaidOrder(current, answered, result.pspReference, undefined);
      if (typeof placed === "string") holdMismatch(current, placed);
    }
    return loadCheckout(checkout.id, "browser");
  }
  // Pending keeps the reservation until the webhook settles it.
  // Answered as it stands now: a webhook may have settled the checkout during the call.
  if (code === "Pending" || code === "Received") return loadCheckout(checkout.id, "browser");
  // A refusal ends this attempt, not the order: the shopper can still pay at continue_url.
  releaseReservation(answered, grantId);
  const retry =
    instrument.handler === "network_token"
      ? "Complete again with another network token, or with no instrument to hand the shopper continue_url."
      : "The shopper can pay at continue_url.";
  const current = stillClaimed(checkout.id, attempt);
  if (!current) return loadCheckout(checkout.id, "browser");
  return saveCheckout({
    ...current,
    phase: "open",
    lastMessage: {
      type: "error",
      code: "payment_refused",
      content: `Adyen answered ${code}${answered.refusalReason ? ` (${answered.refusalReason})` : ""}. ${retry}`,
      severity: "requires_buyer_review",
    },
  });
}

// Spec: knowledge/components/adyen-agentic-commerce.md
// Checkouts: create, update and cancel, and the assessment that says what the caller may do next.
import { variantById } from "../catalog/catalog";
import { config, CURRENCY, paymentsConfigured } from "../core/config";
import { type Customer, customerById } from "../accounts/customers";
import { findBy, get, put } from "../core/db";
import { allows, type Auth } from "../oauth/oauth";
import { isRecord, newId } from "../core/util";
import {
  type Buyer,
  type CardAlias,
  channelOf,
  type Checkout,
  CHECKOUT_TTL_MS,
  type Delivery,
  err,
  type Message,
  now,
  type Order,
  payingNow,
  paymentInProgress,
  welcomeOfferFor,
} from "./model";
import { checkoutPrice, GIFT_LINE_ID, parseBuyer, parseLines } from "./pricing";
import { loadCart, ownedBy } from "./carts";

export function createCheckout(
  body: Record<string, unknown>,
  auth?: Auth,
  web?: { customer?: Customer },
): Checkout {
  // UCP 2026-08-25 cart extension: the business uses the cart's contents and ignores the checkout
  // payload's overlapping fields, so they are not even parsed.
  const cart = typeof body.cart_id === "string" ? loadCart(body.cart_id, auth) : undefined;
  const checkout: Checkout = {
    id: newId("chk"),
    cartId: cart?.id,
    lines: cart ? cart.lines : parseLines(body.line_items),
    buyer: cart?.buyer ?? parseBuyer(body.buyer),
    phase: "open",
    channel: web ? "web" : "agent",
    customerId: web ? web.customer?.id : auth?.grant.customerId,
    // Asked for on the store's own checkout only: an agent's request never carries the offer.
    welcomeOffer:
      web?.customer && body.applyWelcomeOffer === true && isFirstOrderEligible(web.customer.id)
        ? welcomeOfferFor()
        : undefined,
    clientId: auth?.token.clientId,
    grantId: auth?.grant.id,
    agentName: auth?.grant.clientName,
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
    expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
  };
  return put("checkouts", checkout.id, checkout);
}

export function loadCheckout(id: string, auth?: Auth | "browser"): Checkout {
  const checkout = get<Checkout>("checkouts", id);
  if (!checkout) throw err(404, "not_found", "Checkout not found");
  // The protocol side never reaches a shopper's own checkout: the two channels stay apart.
  if (auth !== "browser" && (channelOf(checkout) === "web" || !ownedBy(checkout, auth)))
    throw err(404, "not_found", "Checkout not found");
  return checkout;
}

export const saveCheckout = (c: Checkout) => put("checkouts", c.id, { ...c, updatedAt: now() });

export function updateCheckout(checkout: Checkout, body: Record<string, unknown>): Checkout {
  if (checkout.phase !== "open")
    throw err(409, "checkout_not_editable", `Checkout is ${checkout.phase}`);
  // The amount being paid must not move under the shopper's Drop-in payment.
  if (payingNow(checkout)) throw paymentInProgress();
  // A client that sends back every line it was shown sends the welcome tote too: that line is the
  // offer's, not an order line, so it is set aside here and the offer stays as it was.
  const sent =
    checkout.welcomeOffer && Array.isArray(body.line_items)
      ? body.line_items.filter((l) => !(isRecord(l) && l.id === GIFT_LINE_ID))
      : body.line_items;
  const lines = sent === undefined ? checkout.lines : parseLines(sent, checkout.lines);
  return saveCheckout({
    ...checkout,
    lines,
    buyer: parseBuyer(body.buyer) ?? checkout.buyer,
    lastMessage: undefined,
  });
}

// The shopper's delivery choice, from the checkout page or the Ask panel: the total moves with it,
// so it waits like the lines while a payment holds the checkout.
export function setDelivery(checkout: Checkout, delivery: Delivery): Checkout {
  if (checkout.phase !== "open")
    throw err(409, "checkout_not_editable", `Checkout is ${checkout.phase}`);
  if (payingNow(checkout)) throw paymentInProgress();
  return saveCheckout({ ...checkout, delivery, lastMessage: undefined });
}

export function cancelCheckout(checkout: Checkout): Checkout {
  if (checkout.phase === "completed" || checkout.phase === "complete_in_progress") {
    throw err(409, "checkout_not_cancelable", `Checkout is ${checkout.phase}`);
  }
  if (payingNow(checkout)) throw paymentInProgress();
  return saveCheckout({ ...checkout, phase: "canceled" });
}

// The welcome offer is for an account's first order: the orders collection holds only placed
// orders, so a refused attempt or an abandoned checkout leaves the account eligible.
export const isFirstOrderEligible = (customerId: string): boolean =>
  findBy<Order>("orders", "customerId", customerId).length === 0;

// Binds an open checkout to the signed-in customer (ADR-020): a guest's bag becomes theirs, with
// their email, and when asked the welcome offer joins it if the account has no order yet. Another
// account's checkout is not found, never taken over.
export function claimCheckout(
  checkout: Checkout,
  customer: Customer,
  opts: { applyWelcomeOffer?: boolean } = {},
): Checkout {
  if (checkout.customerId && checkout.customerId !== customer.id)
    throw err(404, "not_found", "Checkout not found");
  if (checkout.phase !== "open")
    throw err(409, "checkout_not_editable", `Checkout is ${checkout.phase}`);
  if (Date.parse(checkout.expiresAt) < Date.now())
    throw err(409, "checkout_expired", "This checkout expired");
  if (payingNow(checkout)) throw paymentInProgress();
  const eligible = isFirstOrderEligible(customer.id);
  const offer = eligible
    ? (checkout.welcomeOffer ?? (opts.applyWelcomeOffer ? welcomeOfferFor() : undefined))
    : undefined;
  return saveCheckout({
    ...checkout,
    customerId: customer.id,
    buyer: {
      ...checkout.buyer,
      email: customer.email,
      first_name: checkout.buyer?.first_name ?? (customer.name || undefined),
    },
    welcomeOffer: offer,
    lastMessage: undefined,
  });
}

// Checked again right before a payment: an account that ordered since the claim (another tab,
// another checkout) loses the offer here, and the payer sees the new total before paying.
export function confirmWelcomeOffer(checkout: Checkout): void {
  if (!checkout.welcomeOffer) return;
  if (checkout.customerId && isFirstOrderEligible(checkout.customerId)) return;
  saveCheckout({ ...checkout, welcomeOffer: undefined });
  throw err(
    409,
    "welcome_offer_ineligible",
    "Welcome offer applies to your first order only. Totals have been updated.",
    undefined,
    "requires_buyer_review",
  );
}

// The account's name and email stand in for a buyer the checkout did not name.
export function buyerOf(checkout: Checkout): Buyer | undefined {
  if (checkout.buyer?.email) return checkout.buyer;
  const customer = customerById(checkout.customerId);
  if (!customer) return checkout.buyer;
  return {
    ...checkout.buyer,
    first_name: checkout.buyer?.first_name ?? customer.name,
    email: customer.email,
  };
}

export type Assessment = {
  status:
    | "incomplete"
    | "requires_escalation"
    | "ready_for_complete"
    | "complete_in_progress"
    | "completed"
    | "canceled";
  messages: Message[];
  card?: CardAlias;
  total: number;
};

// Where the shopper changes an agent's limit: the account page, opened at that agent.
export const budgetUrl = (grantId: string) => `${config().publicOrigin}/account#agent-${grantId}`;

export function assess(checkout: Checkout, auth: Auth | undefined, cards: CardAlias[]): Assessment {
  const { total } = checkoutPrice(checkout);
  const messages: Message[] = checkout.lastMessage ? [checkout.lastMessage] : [];
  if (checkout.phase !== "open") {
    const status = checkout.phase === "completed" ? "completed" : checkout.phase;
    return { status, messages, total };
  }
  // The shopper is paying it in Drop-in: an agent reads it in progress and sends nothing.
  if (payingNow(checkout)) {
    const { content, code, severity } = paymentInProgress().msg;
    return {
      status: "complete_in_progress",
      messages: [...messages, { type: "info", code, content, severity }],
      total,
    };
  }
  if (Date.parse(checkout.expiresAt) < Date.now()) {
    return {
      status: "canceled",
      messages: [
        {
          type: "error",
          code: "checkout_expired",
          content: "This checkout expired",
          severity: "unrecoverable",
        },
      ],
      total,
    };
  }
  const problems: Message[] = [];
  if (!checkout.lines.length)
    problems.push({
      type: "error",
      code: "empty_checkout",
      content: "Add at least one line item",
      severity: "requires_buyer_input",
      path: "$.line_items",
    });
  checkout.lines.forEach((line, i) => {
    if (!variantById(line.variantId)?.available) {
      problems.push({
        type: "error",
        code: "out_of_stock",
        content: `${line.variantId} is sold out`,
        severity: "requires_buyer_input",
        path: `$.line_items[${i}]`,
      });
    }
  });
  if (!buyerOf(checkout)?.email) {
    problems.push({
      type: "error",
      code: "missing_buyer_email",
      content: "buyer.email is required for the receipt",
      severity: "requires_buyer_input",
      path: "$.buyer.email",
    });
  }
  if (problems.length) return { status: "incomplete", messages: [...messages, ...problems], total };

  const escalate = (code: string, content: string): Assessment => ({
    status: "requires_escalation",
    messages: [...messages, { type: "error", code, content, severity: "requires_buyer_review" }],
    total,
  });
  if (!paymentsConfigured())
    return escalate("payments_unavailable", "Payments are not configured on this store");
  if (checkout.handedOverAt)
    return escalate(
      "shopper_pays",
      "The agent handed this checkout to the shopper, who pays at continue_url.",
    );
  // A guest agent can still pay with its own network token, and has no limit of the store's.
  if (!auth) return { status: "ready_for_complete", messages, total };
  const remaining = auth.grant.spendLimit - auth.grant.spent;
  if (total > remaining) {
    return escalate(
      "spend_limit_exceeded",
      `Total ${total} exceeds the remaining agent budget of ${Math.max(remaining, 0)} ${CURRENCY} minor units; the shopper must approve at continue_url, or raise this agent's limit at ${budgetUrl(auth.grant.id)} and the agent completes again.`,
    );
  }
  const card = allows(auth.token.scopes, "ucp:pay") ? cards[0] : undefined;
  if (allows(auth.token.scopes, "ucp:pay") && !card)
    messages.push({
      type: "info",
      code: "no_saved_card",
      content:
        "The account has no saved card: complete with a network token, or complete with no instrument to hand the shopper continue_url.",
    });
  return { status: "ready_for_complete", messages, card, total };
}

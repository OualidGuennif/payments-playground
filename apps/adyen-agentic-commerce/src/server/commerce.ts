// Spec: knowledge/components/adyen-agentic-commerce.md
// Carts, checkouts and orders. Prices come from the catalogue only; a checkout's status comes from
// its lines, the caller's grant and Adyen's answers, never from what a client says it paid.
import * as adyen from "./adyen";
import { productById, variantById } from "./catalog";
import { config, CURRENCY, paymentsConfigured } from "./config";
import { findBy, get, put } from "./db";
import { allows, type Auth, chargeGrant, type Grant } from "./oauth";
import { trace } from "./trace";
import { isRecord, newId, sha256 } from "./util";

export type Line = { id: string; variantId: string; quantity: number };
export type Buyer = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
};
export type Severity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable";
export type Message = {
  type: "error" | "info" | "warning";
  code: string;
  content: string;
  severity?: Severity;
  path?: string;
};

export type Cart = {
  id: string;
  lines: Line[];
  buyer?: Buyer;
  status: "active" | "canceled";
  clientId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Phase = "open" | "complete_in_progress" | "completed" | "canceled";
export type Checkout = {
  id: string;
  cartId?: string;
  lines: Line[];
  buyer?: Buyer;
  phase: Phase;
  clientId?: string;
  grantId?: string;
  agentName?: string;
  attempts: number;
  lastMessage?: Message;
  orderId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type OrderLine = { variantId: string; title: string; quantity: number; unitPrice: number };
export type Order = {
  id: string;
  checkoutId: string;
  lines: OrderLine[];
  subtotal: number;
  fulfillment: number;
  total: number;
  currency: string;
  buyer?: Buyer;
  status: "authorised" | "pending";
  paidBy: "agent" | "shopper";
  agentName?: string;
  pspReference?: string;
  webhook?: { eventCode: string; success: boolean; at: string };
  createdAt: string;
};

export type PaymentRecord = {
  id: string;
  purpose: "agent" | "shopper" | "card-save";
  checkoutId?: string;
  reference: string;
  amount: number;
  // The lines this amount was priced from: the order is placed from them, not from the checkout,
  // which stays editable while a Drop-in session is open.
  lines?: Line[];
  // An agent payment's hold on the grant's budget: settled once, by whichever path learns first.
  reservation?: "held" | "released";
  sessionId?: string;
  resultCode?: string;
  pspReference?: string;
  refusalReason?: string;
  agentName?: string;
  createdAt: string;
  updatedAt: string;
};

export type CardAlias = {
  alias: string;
  storedPaymentMethodId: string;
  brand: string;
  lastFour: string;
  expiryMonth: string;
  expiryYear: string;
};

export const DEMO_SHOPPER: Buyer = {
  first_name: "Alex",
  last_name: "Demo",
  email: "shopper@example.com",
};
export const MAX_LINES = 20;
export const MAX_QUANTITY = 10;
export const FREE_SHIPPING_FROM = 10000;
export const SHIPPING = 495;
const CHECKOUT_TTL_MS = 6 * 3600_000;

export class CommerceError extends Error {
  constructor(
    readonly status: number,
    readonly msg: Message,
  ) {
    super(msg.content);
  }
}

const err = (
  status: number,
  code: string,
  content: string,
  path?: string,
  severity: Severity = "unrecoverable",
) => new CommerceError(status, { type: "error", code, content, severity, path });

const now = () => new Date().toISOString();

// --- pricing -----------------------------------------------------------------------------------

export function price(lines: Line[]) {
  const items = lines.map((line) => {
    const variant = variantById(line.variantId);
    if (!variant) throw err(400, "item_not_found", `Unknown item ${line.variantId}`);
    return { line, variant, amount: variant.price * line.quantity };
  });
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const fulfillment = subtotal === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING;
  return { items, subtotal, fulfillment, total: subtotal + fulfillment };
}

export function totals(lines: Line[]) {
  const p = price(lines);
  return [
    { type: "subtotal", display_text: "Subtotal", amount: p.subtotal },
    {
      type: "fulfillment",
      display_text: p.fulfillment ? "Standard shipping" : "Free shipping",
      amount: p.fulfillment,
    },
    { type: "total", display_text: "Total (VAT included)", amount: p.total },
  ];
}

export function parseLines(input: unknown, previous: Line[] = []): Line[] {
  if (!Array.isArray(input))
    throw err(400, "invalid_line_items", "line_items must be an array", "$.line_items");
  if (input.length > MAX_LINES)
    throw err(400, "too_many_line_items", `At most ${MAX_LINES} line items`, "$.line_items");
  const merged = new Map<string, Line>();
  input.forEach((raw, index) => {
    const path = `$.line_items[${index}]`;
    if (!isRecord(raw) || !isRecord(raw.item) || typeof raw.item.id !== "string") {
      throw err(400, "invalid_line_item", "Each line item needs item.id", path);
    }
    let id = raw.item.id;
    if (!variantById(id)) {
      const product = productById(id);
      const only = product && product.colours.length * product.sizes.length === 1;
      if (!product)
        throw err(
          400,
          "item_not_found",
          `No item ${id}. Use a variant id from the catalogue.`,
          `${path}.item.id`,
        );
      if (!only)
        throw err(
          400,
          "variant_required",
          `${id} has several variants; pass a variant id (colour and size).`,
          `${path}.item.id`,
        );
      id = `${product.id}-${product.colours[0]!.id}-one-size`;
    }
    const quantity = raw.quantity ?? 1;
    if (
      !Number.isInteger(quantity) ||
      (quantity as number) < 1 ||
      (quantity as number) > MAX_QUANTITY
    ) {
      throw err(
        400,
        "invalid_quantity",
        `quantity must be an integer from 1 to ${MAX_QUANTITY}`,
        `${path}.quantity`,
      );
    }
    const existing = merged.get(id);
    const lineId =
      typeof raw.id === "string" && previous.some((p) => p.id === raw.id)
        ? raw.id
        : (previous.find((p) => p.variantId === id)?.id ?? `li_${sha256(id).slice(0, 10)}`);
    merged.set(id, {
      id: existing?.id ?? lineId,
      variantId: id,
      quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + (quantity as number)),
    });
  });
  return [...merged.values()];
}

export function parseBuyer(input: unknown): Buyer | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw err(400, "invalid_buyer", "buyer must be an object", "$.buyer");
  const pick = (k: keyof Buyer, max: number) => {
    const v = input[k];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || v.length > max)
      throw err(400, "invalid_buyer", `buyer.${k} is not valid`, `$.buyer.${k}`);
    return v.trim();
  };
  const email = pick("email", 254);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw err(400, "invalid_email", "buyer.email is not an email address", "$.buyer.email");
  return {
    first_name: pick("first_name", 80),
    last_name: pick("last_name", 80),
    email,
    phone_number: pick("phone_number", 32),
  };
}

// --- saved cards -------------------------------------------------------------------------------

let cardCache: { at: number; cards: CardAlias[] } | undefined;

export function cardAlias(storedPaymentMethodId: string) {
  return `card_${sha256(`velune:${storedPaymentMethodId}`).slice(0, 20)}`;
}

export async function savedCards(refresh = false): Promise<CardAlias[]> {
  if (!paymentsConfigured()) return [];
  if (!refresh && cardCache && Date.now() - cardCache.at < 60_000) return cardCache.cards;
  try {
    const cards = (await adyen.storedCards())
      .filter((c) => c.models.includes("UnscheduledCardOnFile"))
      .map((c) => ({
        alias: cardAlias(c.storedPaymentMethodId),
        storedPaymentMethodId: c.storedPaymentMethodId,
        brand: c.brand,
        lastFour: c.lastFour,
        expiryMonth: c.expiryMonth,
        expiryYear: c.expiryYear,
      }));
    cardCache = { at: Date.now(), cards };
    return cards;
  } catch (error) {
    trace({
      channel: "adyen",
      actor: "server",
      method: "GET",
      path: "/storedPaymentMethods",
      status: 502,
      ref: null,
      detail: { error: (error as Error).message },
    });
    return cardCache?.cards ?? [];
  }
}

export function forgetCardCache() {
  cardCache = undefined;
}

// --- carts -------------------------------------------------------------------------------------

export function createCart(body: Record<string, unknown>, clientId?: string): Cart {
  const lines = parseLines(body.line_items);
  const cart: Cart = {
    id: newId("cart"),
    lines,
    buyer: parseBuyer(body.buyer),
    status: "active",
    clientId,
    createdAt: now(),
    updatedAt: now(),
  };
  return put("carts", cart.id, cart);
}

export function loadCart(id: string, clientId?: string): Cart {
  const cart = get<Cart>("carts", id);
  if (!cart || (cart.clientId && cart.clientId !== clientId))
    throw err(404, "not_found", "Cart not found");
  return cart;
}

export function updateCart(cart: Cart, body: Record<string, unknown>): Cart {
  if (cart.status !== "active") throw err(409, "cart_canceled", "This cart was canceled");
  const lines =
    body.line_items === undefined ? cart.lines : parseLines(body.line_items, cart.lines);
  return put("carts", cart.id, {
    ...cart,
    lines,
    buyer: parseBuyer(body.buyer) ?? cart.buyer,
    updatedAt: now(),
  });
}

export function cancelCart(cart: Cart): Cart {
  return put("carts", cart.id, { ...cart, status: "canceled", updatedAt: now() });
}

// --- checkouts ---------------------------------------------------------------------------------

export function createCheckout(body: Record<string, unknown>, auth?: Auth): Checkout {
  let lines: Line[];
  if (typeof body.cart_id === "string" && body.line_items === undefined) {
    lines = loadCart(body.cart_id, auth?.token.clientId).lines;
  } else {
    lines = parseLines(body.line_items);
  }
  const checkout: Checkout = {
    id: newId("chk"),
    cartId: typeof body.cart_id === "string" ? body.cart_id : undefined,
    lines,
    buyer: parseBuyer(body.buyer),
    phase: "open",
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
  if (auth !== "browser" && checkout.clientId && checkout.clientId !== auth?.token.clientId) {
    throw err(404, "not_found", "Checkout not found");
  }
  return checkout;
}

const saveCheckout = (c: Checkout) => put("checkouts", c.id, { ...c, updatedAt: now() });

export function updateCheckout(checkout: Checkout, body: Record<string, unknown>): Checkout {
  if (checkout.phase !== "open")
    throw err(409, "checkout_not_editable", `Checkout is ${checkout.phase}`);
  const lines =
    body.line_items === undefined ? checkout.lines : parseLines(body.line_items, checkout.lines);
  return saveCheckout({
    ...checkout,
    lines,
    buyer: parseBuyer(body.buyer) ?? checkout.buyer,
    lastMessage: undefined,
  });
}

export function cancelCheckout(checkout: Checkout): Checkout {
  if (checkout.phase === "completed" || checkout.phase === "complete_in_progress") {
    throw err(409, "checkout_not_cancelable", `Checkout is ${checkout.phase}`);
  }
  return saveCheckout({ ...checkout, phase: "canceled" });
}

function buyerOf(checkout: Checkout, auth?: Auth): Buyer | undefined {
  if (checkout.buyer?.email) return checkout.buyer;
  return auth || checkout.clientId ? { ...DEMO_SHOPPER, ...checkout.buyer } : checkout.buyer;
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

export function assess(checkout: Checkout, auth: Auth | undefined, cards: CardAlias[]): Assessment {
  const { total } = price(checkout.lines);
  const messages: Message[] = checkout.lastMessage ? [checkout.lastMessage] : [];
  if (checkout.phase !== "open") {
    const status = checkout.phase === "completed" ? "completed" : checkout.phase;
    return { status, messages, total };
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
  if (!buyerOf(checkout, auth)?.email) {
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
  if (!auth)
    return escalate(
      "sign_in_required",
      "Sign in with OAuth (scopes dev.ucp.shopping.checkout:manage and ucp:pay) to pay with the shopper's saved card, or hand the shopper the continue_url.",
    );
  if (!allows(auth.token.scopes, "ucp:pay"))
    return escalate(
      "insufficient_scope",
      "The ucp:pay scope is needed to pay; the shopper can pay at continue_url.",
    );
  const card = cards[0];
  if (!card)
    return escalate(
      "no_saved_card",
      "The shopper has no saved card yet; they can pay at continue_url and save one in their account.",
    );
  const remaining = auth.grant.spendLimit - auth.grant.spent;
  if (total > remaining) {
    return escalate(
      "spend_limit_exceeded",
      `Total ${total} exceeds the remaining agent budget of ${Math.max(remaining, 0)} ${CURRENCY} minor units; the shopper must approve at continue_url.`,
    );
  }
  return { status: "ready_for_complete", messages, card, total };
}

// --- payment -----------------------------------------------------------------------------------

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
  auth?: Auth,
  paidLines: Line[] = checkout.lines,
): Order {
  const p = price(paidLines);
  const order: Order = {
    id: newId("ord"),
    checkoutId: checkout.id,
    lines: snapshot(paidLines),
    subtotal: p.subtotal,
    fulfillment: p.fulfillment,
    total: p.total,
    currency: CURRENCY,
    buyer: buyerOf(checkout, auth),
    status,
    paidBy,
    agentName: paidBy === "agent" ? checkout.agentName : undefined,
    pspReference,
    createdAt: now(),
  };
  put("orders", order.id, order);
  saveCheckout({ ...checkout, phase: "completed", orderId: order.id, lastMessage: undefined });
  return order;
}

/**
 * Gives an agent payment's reservation back, once: the synchronous answer and the webhook can both
 * report a refusal, and only the first gives the budget back.
 */
function releaseReservation(record: PaymentRecord, grantId: string | undefined): PaymentRecord {
  const fresh = get<PaymentRecord>("payments", record.id) ?? record;
  if (fresh.reservation !== "held" || !grantId) return fresh;
  chargeGrant(grantId, -fresh.amount);
  return put("payments", fresh.id, { ...fresh, reservation: "released", updatedAt: now() });
}

/**
 * Charges an agent payment Adyen authorised whose reservation was given back on an unknown outcome
 * (a network error after Adyen had already authorised it), so the budget counts every payment.
 */
function holdReservation(record: PaymentRecord, grantId: string | undefined): void {
  const fresh = get<PaymentRecord>("payments", record.id) ?? record;
  if (fresh.reservation !== "released" || !grantId) return;
  chargeGrant(grantId, fresh.amount);
  put("payments", fresh.id, { ...fresh, reservation: "held", updatedAt: now() });
}

/**
 * The order for a payment Adyen authorised, or why none is placed. The lines come from the payment
 * record, and the amount Adyen reports, when it reports one, must be the amount that was sent.
 */
function placePaidOrder(
  checkout: Checkout,
  record: PaymentRecord,
  pspReference: string | undefined,
  reportedAmount: number | undefined,
  auth?: Auth,
): Order | string {
  const lines = record.lines ?? checkout.lines;
  if (reportedAmount !== undefined && reportedAmount !== record.amount)
    return `Adyen authorised ${reportedAmount}, the payment was sent for ${record.amount}`;
  if (price(lines).total !== record.amount)
    return `The lines total ${price(lines).total}, the payment was sent for ${record.amount}`;
  const paidBy = record.purpose === "agent" ? "agent" : "shopper";
  return placeOrder(checkout, paidBy, pspReference, "authorised", auth, lines);
}

/**
 * No order: the amounts disagree. The checkout is held in progress, so neither the agent nor the
 * shopper can pay it again or edit it, and it says why; nothing reads as paid.
 */
function holdMismatch(checkout: Checkout, reason: string): void {
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
    lastMessage: {
      type: "error",
      code: "amount_mismatch",
      content: `No order was placed: ${reason}. Check the payment in the Back Office.`,
      severity: "requires_buyer_review",
    },
  });
}

export function instrumentAlias(body: Record<string, unknown>): string | undefined {
  const payment = isRecord(body.payment) ? body.payment : undefined;
  const instruments = Array.isArray(payment?.instruments) ? payment.instruments : [];
  const chosen = instruments.find((i) => isRecord(i) && i.selected === true) ?? instruments[0];
  if (!isRecord(chosen)) return undefined;
  if (chosen.handler_id !== undefined && chosen.handler_id !== "saved_card") {
    throw err(
      400,
      "unsupported_handler",
      "Only the saved_card handler is accepted here",
      "$.payment.instruments[0].handler_id",
    );
  }
  const credential = isRecord(chosen.credential) ? chosen.credential : undefined;
  return typeof credential?.token === "string"
    ? credential.token
    : typeof chosen.id === "string"
      ? chosen.id
      : undefined;
}

export async function completeCheckout(
  loaded: Checkout,
  body: Record<string, unknown>,
  auth?: Auth,
): Promise<Checkout> {
  const cards = await savedCards();
  // Re-read after the await: from here to the claim nothing yields, so a parallel complete that
  // claimed the checkout meanwhile is seen and no second payment is sent.
  const checkout = get<Checkout>("checkouts", loaded.id) ?? loaded;
  if (checkout.phase === "completed" || checkout.phase === "complete_in_progress") return checkout;
  if (checkout.phase === "canceled")
    throw err(409, "checkout_canceled", "This checkout was canceled");
  // The grant as it stands now, not as the token found it: a complete on another checkout may have
  // reserved part of the budget during the await above, or the shopper may have revoked it.
  const grant = auth ? get<Grant>("grants", auth.grant.id) : undefined;
  const live = auth && grant && !grant.revoked ? { ...auth, grant } : undefined;
  const assessment = assess(checkout, live, cards);
  if (assessment.status !== "ready_for_complete" || !live) return checkout;
  const alias = instrumentAlias(body);
  const card = cards.find((c) => c.alias === alias);
  if (!card)
    throw err(
      400,
      "unknown_instrument",
      "Pass one of the instruments listed in checkout.payment.instruments",
      "$.payment.instruments",
    );

  // Claimed and the budget reserved synchronously before the network call, so a parallel complete
  // sees the checkout in progress and the grant already charged; a refusal or an error gives it back.
  const attempt = checkout.attempts + 1;
  const claimed = saveCheckout({
    ...checkout,
    phase: "complete_in_progress",
    attempts: attempt,
    grantId: live.grant.id,
    agentName: live.grant.clientName,
    clientId: live.token.clientId,
  });
  chargeGrant(live.grant.id, assessment.total);
  const reference = `${checkout.id}-a${attempt}`;
  const record: PaymentRecord = {
    id: newId("pay"),
    purpose: "agent",
    checkoutId: checkout.id,
    reference,
    amount: assessment.total,
    lines: checkout.lines,
    reservation: "held",
    agentName: live.grant.clientName,
    createdAt: now(),
    updatedAt: now(),
  };
  put("payments", record.id, record);
  let result: Awaited<ReturnType<typeof adyen.payWithSavedCard>>;
  try {
    result = await adyen.payWithSavedCard({
      amount: assessment.total,
      reference,
      storedPaymentMethodId: card.storedPaymentMethodId,
      idempotencyKey: `agent-pay-${reference}`,
      shopperEmail: buyerOf(checkout, live)?.email,
      metadata: { checkoutId: checkout.id, agent: live.grant.clientName.slice(0, 80) },
    });
  } catch (error) {
    // A success webhook can arrive while the call is in flight and then the call time out: the
    // payment is Authorised and the webhook settled it, so nothing here may undo that.
    if (get<PaymentRecord>("payments", record.id)?.resultCode === "Authorised") {
      return loadCheckout(checkout.id, "browser");
    }
    // The retry reserves again under the same reference; if Adyen did authorise this call, its
    // webhook charges the budget again before the order is placed.
    const released = releaseReservation(record, live.grant.id);
    put("payments", record.id, {
      ...released,
      resultCode: "Error",
      refusalReason: (error as Error).message.slice(0, 200),
      updatedAt: now(),
    });
    trace({
      channel: "adyen",
      actor: "server",
      method: "POST",
      path: "/payments",
      status: 502,
      ref: checkout.id,
      detail: { reference, error: (error as Error).message },
    });
    return saveCheckout({
      ...claimed,
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
  // Re-read: a webhook may have settled this payment while the call was in flight.
  const answered = put("payments", record.id, {
    ...(get<PaymentRecord>("payments", record.id) ?? record),
    ...result,
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
      reference,
      amount: assessment.total,
      shopperInteraction: "ContAuth",
      recurringProcessingModel: "UnscheduledCardOnFile",
      ...result,
    },
  });
  if (result.resultCode === "Authorised") {
    // The webhook may have placed the order, or held a mismatch, while the call was in flight.
    const current = get<Checkout>("checkouts", checkout.id) ?? claimed;
    if (!current.orderId && current.lastMessage?.code !== "amount_mismatch") {
      holdReservation(answered, live.grant.id);
      const placed = placePaidOrder(current, answered, result.pspReference, undefined, live);
      if (typeof placed === "string") holdMismatch(current, placed);
    }
    return loadCheckout(checkout.id, "browser");
  }
  // Pending keeps the reservation until the webhook settles it.
  if (result.resultCode === "Pending" || result.resultCode === "Received") return claimed;
  // A refusal ends this attempt, not the order: the shopper can still pay at continue_url.
  releaseReservation(answered, live.grant.id);
  return saveCheckout({
    ...claimed,
    phase: "open",
    lastMessage: {
      type: "error",
      code: "payment_refused",
      content: `Adyen answered ${result.resultCode}${result.refusalReason ? ` (${result.refusalReason})` : ""}. The shopper can pay at continue_url.`,
      severity: "requires_buyer_review",
    },
  });
}

// --- the shopper's browser ---------------------------------------------------------------------

export async function startShopperSession(checkout: Checkout) {
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
  const attempt = checkout.attempts + 1;
  saveCheckout({ ...checkout, attempts: attempt });
  const reference = `${checkout.id}-s${attempt}`;
  const session = await adyen.createSession({
    amount: assessment.total,
    reference,
    returnUrl: `${config().publicOrigin}/checkout/${checkout.id}`,
    shopperEmail: buyerOf(checkout)?.email ?? DEMO_SHOPPER.email,
    purpose: "order",
    metadata: { checkoutId: checkout.id },
  });
  put<PaymentRecord>("payments", reference, {
    id: reference,
    purpose: "shopper",
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
    saveCheckout({ ...checkout, phase: "complete_in_progress" });
  }
  return loadCheckout(checkout.id, "browser");
}

export async function startCardSave() {
  const reference = newId("cardsave");
  const session = await adyen.createSession({
    amount: 0,
    reference,
    returnUrl: `${config().publicOrigin}/account`,
    purpose: "card-save",
    shopperEmail: DEMO_SHOPPER.email,
    metadata: { purpose: "card-save" },
  });
  put<PaymentRecord>("payments", reference, {
    id: reference,
    purpose: "card-save",
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

export async function finishCardSave(sessionId: string, sessionResult: string) {
  const record = findBy<PaymentRecord>("payments", "sessionId", sessionId).find(
    (p) => p.purpose === "card-save",
  );
  if (!record) throw err(404, "not_found", "Unknown card session");
  const result = await adyen.sessionResult(sessionId, sessionResult);
  put("payments", record.id, {
    ...record,
    resultCode: result.payments[0]?.resultCode ?? result.status,
    pspReference: result.payments[0]?.pspReference,
    updatedAt: now(),
  });
  forgetCardCache();
  return result.status;
}

// --- webhooks ----------------------------------------------------------------------------------

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
  if (checkout.phase === "complete_in_progress" && current.includes(record.reference)) {
    // The agent's budget was reserved when the payment was sent; a refusal gives it back once.
    if (record.purpose === "agent") releaseReservation(record, checkout.grantId);
    saveCheckout({
      ...checkout,
      phase: "open",
      lastMessage: {
        type: "error",
        code: "payment_refused",
        content: `Adyen refused the payment${item.reason ? ` (${item.reason})` : ""}`,
        severity: "requires_buyer_review",
      },
    });
  }
  return "refusal recorded";
}

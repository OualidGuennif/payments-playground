// Spec: knowledge/components/adyen-agentic-commerce.md
// The records commerce keeps (carts, checkouts, orders, payments), its limits and its error.

export type Line = { id: string; variantId: string; quantity: number };
// Where a record was made: the store's pages and /api, or UCP REST and MCP (ADR-015).
export type Channel = "web" | "agent";
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
  customerId?: string;
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
  channel?: Channel;
  customerId?: string;
  clientId?: string;
  grantId?: string;
  agentName?: string;
  attempts: number;
  lastMessage?: Message;
  orderId?: string;
  // When an agent completed with no instrument: from then on the shopper pays at continue_url.
  handedOverAt?: string;
  // The shopper's Drop-in payment that holds this checkout until `until` (lock.ts).
  paying?: { channel: Channel; reference: string; until: string };
  // The signed-in account whose browser claimed that hold, when it is not the checkout's own
  // account (a guest bag, or another account's): its other payments wait too (lock.ts).
  payerId?: string;
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
  // Where the checkout was made; paidBy says who paid it.
  channel?: Channel;
  customerId?: string;
  clientId?: string;
  paidBy: "agent" | "shopper";
  agentName?: string;
  pspReference?: string;
  webhook?: { eventCode: string; success: boolean; at: string };
  createdAt: string;
};

export type PaymentRecord = {
  id: string;
  purpose: "agent" | "shopper" | "card-save";
  channel?: Channel;
  // A card save belongs to the account that started it.
  customerId?: string;
  instrument?: "saved_card" | "network_token";
  lastFour?: string;
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

// Records made before v0.4.0 carry no channel: an agent made them when an agent's name or client
// is on them, the shopper's browser otherwise.
export function channelOf(record: {
  channel?: Channel;
  agentName?: string;
  clientId?: string;
  purpose?: string;
}): Channel {
  if (record.channel) return record.channel;
  if (record.purpose) return record.purpose === "agent" ? "agent" : "web";
  return record.agentName || record.clientId ? "agent" : "web";
}

export type CardAlias = {
  alias: string;
  storedPaymentMethodId: string;
  brand: string;
  lastFour: string;
  expiryMonth: string;
  expiryYear: string;
};

export const MAX_LINES = 20;
export const MAX_QUANTITY = 10;
export const FREE_SHIPPING_FROM = 10000;
export const SHIPPING = 495;
export const CHECKOUT_TTL_MS = 6 * 3600_000;

export class CommerceError extends Error {
  constructor(
    readonly status: number,
    readonly msg: Message,
  ) {
    super(msg.content);
  }
}

export const err = (
  status: number,
  code: string,
  content: string,
  path?: string,
  severity: Severity = "unrecoverable",
) => new CommerceError(status, { type: "error", code, content, severity, path });

export const now = () => new Date().toISOString();

// Long enough for a 3-D Secure challenge; a shopper who walks away frees the checkout after it.
export const PAYING_MS = 15 * 60_000;

/** The Drop-in payment holding this checkout now, if any: an expired hold holds nothing. */
export const payingNow = (checkout: Checkout, at = Date.now()) =>
  checkout.paying && Date.parse(checkout.paying.until) > at ? checkout.paying : undefined;

export const paymentInProgress = () =>
  err(
    409,
    "payment_in_progress",
    "A payment for this checkout is already in progress",
    undefined,
    "requires_buyer_review",
  );

// Spec: knowledge/components/adyen-agentic-commerce.md
// What the widgets show and send, kept apart from the DOM so it can be tested: views of the UCP
// answers and the tool calls their buttons make. A widget decides nothing the store does not
// check again (ADR-017), and never writes to the assistant.

export type Call = { name: string; arguments: Record<string, unknown> };

type Money = { amount: number; currency?: string };
type Media = { url?: string; alt_text?: string };
type OptionValue = { id?: string; label: string };
export type UcpVariant = {
  id: string;
  title?: string;
  price?: Money;
  availability?: { available?: boolean };
  options?: { name: string; id?: string; label: string }[];
  media?: Media[];
};
export type UcpProduct = {
  id: string;
  title: string;
  description?: { plain?: string };
  price_range?: { min?: Money; max?: Money };
  media?: Media[];
  options?: { name: string; values: OptionValue[] }[];
  variants?: UcpVariant[];
};
type UcpLine = {
  id?: string;
  item?: { id?: string; title?: string; price?: number | Money; image_url?: string };
  quantity?: number | { total?: number };
  totals?: { type: string; amount: number }[];
};
type UcpMessage = { type?: string; code?: string; content?: string };

// The store writes its messages for the agent (field paths, minor units, URLs to hand on); the
// shopper reads these instead. null: the pay area already says it, with its buttons. A code
// missing here keeps the store's own words.
const SHOPPER_TEXT: Record<string, string | null> = {
  spend_limit_exceeded: null,
  checkout_expired: "This checkout expired. Check out again from your bag.",
  empty_checkout: "Your bag is empty.",
  missing_buyer_email: "The store needs an email for the receipt.",
  out_of_stock: "Something in your bag has just sold out. Remove it to go on.",
  no_saved_card: "Your account has no saved card. Save one on the store, or approve there.",
  payment_refused: "The card was refused. Try again, or choose another card.",
  payment_unavailable: "The payment could not start. Try again in a moment.",
  amount_mismatch:
    "No order was placed: the payment did not match your bag. The store will check it.",
};
type UcpInstrument = {
  id?: string;
  handler_id?: string;
  display?: { brand?: string; last_digits?: string; expiry_month?: number; expiry_year?: number };
};

export type CatalogView = {
  products: UcpProduct[];
  cursor?: string;
  hasNext: boolean;
  total?: number;
};

export type BagLine = {
  variantId: string;
  title: string;
  quantity: number;
  amount: number;
  image?: string;
};
export type Instrument = { id: string; label: string };
export type BagView = {
  kind: "cart" | "checkout";
  id: string;
  status: string;
  currency: string;
  lines: BagLine[];
  subtotal?: number;
  shipping?: number;
  total: number;
  instruments: Instrument[];
  continueUrl?: string;
  manageUrl?: string;
  order?: { label: string; url?: string };
  problems: string[];
  codes: string[];
};

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const whole = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// The Ask panel hands the store's own pictures over inline, because Chromium refuses its opaque
// frame's requests to a loopback store. In an <img> such a URL draws and runs nothing.
const INLINE_IMAGE = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
export const inlineImage = (url: unknown): url is string =>
  typeof url === "string" && INLINE_IMAGE.test(url);

// The UCP envelope names one capability per answer; it says which view the answer belongs to.
export function capabilityOf(data: unknown): string | undefined {
  if (!record(data) || !record(data.ucp) || !record(data.ucp.capabilities)) return undefined;
  return Object.keys(data.ucp.capabilities)[0];
}

export function catalogView(data: unknown): CatalogView | undefined {
  if (!record(data)) return undefined;
  const products = Array.isArray(data.products)
    ? data.products
    : record(data.product)
      ? [data.product]
      : undefined;
  if (!products) return undefined;
  const page = record(data.pagination) ? data.pagination : {};
  return {
    products: products.filter(
      (p): p is UcpProduct => record(p) && typeof p.id === "string" && typeof p.title === "string",
    ),
    cursor: text(page.cursor),
    hasNext: page.has_next_page === true && text(page.cursor) !== undefined,
    total: whole(page.total_count),
  };
}

const amountOf = (price: unknown) => (record(price) ? whole(price.amount) : whole(price));
const totalOf = (totals: unknown, type: string) =>
  Array.isArray(totals)
    ? whole(totals.find((t) => record(t) && t.type === type)?.amount)
    : undefined;

function lineOf(line: UcpLine): BagLine | undefined {
  const variantId = text(line.item?.id);
  if (!variantId) return undefined;
  const quantity = record(line.quantity) ? whole(line.quantity.total) : whole(line.quantity);
  const each = amountOf(line.item?.price) ?? 0;
  return {
    variantId,
    title: text(line.item?.title) ?? variantId,
    quantity: quantity ?? 1,
    amount: totalOf(line.totals, "total") ?? each * (quantity ?? 1),
    image: text(line.item?.image_url),
  };
}

function instrumentOf(raw: UcpInstrument): Instrument | undefined {
  if (raw.handler_id !== "saved_card" || typeof raw.id !== "string") return undefined;
  const d = raw.display ?? {};
  const brand = d.brand ? d.brand.charAt(0).toUpperCase() + d.brand.slice(1) : "Card";
  const expiry =
    d.expiry_month && d.expiry_year
      ? ` · ${String(d.expiry_month).padStart(2, "0")}/${String(d.expiry_year).slice(-2)}`
      : "";
  return { id: raw.id, label: `${brand} •••• ${d.last_digits ?? "????"}${expiry}` };
}

export function bagView(data: unknown): BagView | undefined {
  const capability = capabilityOf(data);
  if (!record(data) || typeof data.id !== "string") return undefined;
  const kind =
    capability === "dev.ucp.shopping.checkout"
      ? "checkout"
      : capability === "dev.ucp.shopping.cart"
        ? "cart"
        : undefined;
  if (!kind) return undefined;
  const messages = (Array.isArray(data.messages) ? data.messages : []).filter(record);
  const payment = record(data.payment) ? data.payment : {};
  const order = record(data.order) ? data.order : undefined;
  const budget = record(data.agent_budget) ? data.agent_budget : {};
  return {
    kind,
    id: data.id,
    status: text(data.status) ?? "",
    currency: text(data.currency) ?? "EUR",
    lines: (Array.isArray(data.line_items) ? data.line_items : [])
      .filter(record)
      .map((l) => lineOf(l as UcpLine))
      .filter((l): l is BagLine => l !== undefined),
    subtotal: totalOf(data.totals, "subtotal"),
    shipping: totalOf(data.totals, "fulfillment"),
    total: totalOf(data.totals, "total") ?? 0,
    instruments: (Array.isArray(payment.instruments) ? payment.instruments : [])
      .filter(record)
      .map((i) => instrumentOf(i as UcpInstrument))
      .filter((i): i is Instrument => i !== undefined),
    continueUrl: text(data.continue_url),
    manageUrl: text(budget.manage_url),
    order: order
      ? { label: text(order.label) ?? "Order", url: text(order.permalink_url) }
      : undefined,
    problems: [
      ...new Set(
        messages
          .filter((m: UcpMessage) => m.type === "error" && typeof m.content === "string")
          .map((m: UcpMessage) =>
            m.code && Object.hasOwn(SHOPPER_TEXT, m.code) ? SHOPPER_TEXT[m.code] : m.content,
          )
          .filter((p): p is string => typeof p === "string"),
      ),
    ],
    codes: messages.map((m: UcpMessage) => m.code).filter((c): c is string => !!c),
  };
}

export function money(amount: number, currency = "EUR") {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

// --- choosing a variant -----------------------------------------------------------------------

export type Choice = { colour?: string; size?: string };
const optionOf = (v: UcpVariant, name: string) => v.options?.find((o) => o.name === name);
const colourKey = (o: { id?: string; label: string } | undefined) => o?.id ?? o?.label;

export const coloursOf = (p: UcpProduct) =>
  p.options?.find((o) => o.name === "colour")?.values ?? [];
export const sizesOf = (p: UcpProduct) => p.options?.find((o) => o.name === "size")?.values ?? [];

// The variant answering the shopper's choice; an unset option takes the first variant's value.
export function variantFor(p: UcpProduct, choice: Choice): UcpVariant | undefined {
  const first = p.variants?.[0];
  const colour = choice.colour ?? colourKey(first && optionOf(first, "colour"));
  const size = choice.size ?? (first && optionOf(first, "size")?.label);
  return p.variants?.find(
    (v) => colourKey(optionOf(v, "colour")) === colour && optionOf(v, "size")?.label === size,
  );
}

// Whether a pill leads anywhere: some returned variant has it with the other option as chosen.
export function offered(p: UcpProduct, choice: Choice, name: "colour" | "size", value: string) {
  return (p.variants ?? []).some((v) => {
    const mine = name === "colour" ? colourKey(optionOf(v, "colour")) : optionOf(v, "size")?.label;
    const other =
      name === "colour"
        ? choice.size === undefined || optionOf(v, "size")?.label === choice.size
        : choice.colour === undefined || colourKey(optionOf(v, "colour")) === choice.colour;
    return mine === value && other && v.availability?.available !== false;
  });
}

export const describe = (p: UcpProduct, v: UcpVariant) => {
  const colour = optionOf(v, "colour")?.label;
  const size = optionOf(v, "size")?.label;
  const parts = [colour, size && size !== "One size" ? `size ${size}` : size].filter(Boolean);
  return parts.length ? `${p.title} in ${parts.join(", ")}` : p.title;
};

// --- the tool calls ------------------------------------------------------------------------------

export const newKey = () => crypto.randomUUID();
const meta = (key: string) => ({ "idempotency-key": key });
const linesOf = (bag: BagView) =>
  bag.lines.map((l) => ({ item: { id: l.variantId }, quantity: l.quantity }));

export function searchCall(query: string, cursor?: string): Call {
  const catalog: Record<string, unknown> = { query: query.trim().slice(0, 200) };
  if (cursor) catalog.pagination = { cursor };
  return { name: "search_catalog", arguments: { catalog } };
}

// The bag the widget shows is extended where it is, a cart by update_cart and an open checkout by
// update_checkout, so the shopper pays for what they see. Without one a new cart starts. A line
// holds 1 to 10.
export function addCall(bag: BagView | undefined, variantId: string, key = newKey()): Call {
  const open = bag && (bag.kind === "cart" ? bag.status !== "canceled" : OPEN.has(bag.status));
  if (bag && open) {
    const lines = linesOf(bag);
    const same = lines.find((l) => l.item.id === variantId);
    if (same) same.quantity = Math.min(same.quantity + 1, 10);
    else lines.push({ item: { id: variantId }, quantity: 1 });
    return bag.kind === "cart"
      ? {
          name: "update_cart",
          arguments: { meta: meta(key), id: bag.id, cart: { line_items: lines } },
        }
      : {
          name: "update_checkout",
          arguments: { meta: meta(key), id: bag.id, checkout: { line_items: lines } },
        };
  }
  return {
    name: "create_cart",
    arguments: {
      meta: meta(key),
      cart: { line_items: [{ item: { id: variantId }, quantity: 1 }] },
    },
  };
}

// The last line stays: an empty cart or checkout is something only the assistant may cancel.
export function quantityCall(
  bag: BagView,
  variantId: string,
  quantity: number,
  key = newKey(),
): Call | undefined {
  if (bag.kind === "checkout" && !OPEN.has(bag.status)) return undefined;
  const lines = linesOf(bag)
    .map((l) => (l.item.id === variantId ? { ...l, quantity: Math.min(quantity, 10) } : l))
    .filter((l) => l.quantity > 0);
  if (!lines.length) return undefined;
  return bag.kind === "cart"
    ? {
        name: "update_cart",
        arguments: { meta: meta(key), id: bag.id, cart: { line_items: lines } },
      }
    : {
        name: "update_checkout",
        arguments: { meta: meta(key), id: bag.id, checkout: { line_items: lines } },
      };
}

export const checkoutCall = (cartId: string, key = newKey()): Call => ({
  name: "create_checkout",
  arguments: { meta: meta(key), checkout: { cart_id: cartId } },
});

export const refreshCheckoutCall = (checkoutId: string): Call => ({
  name: "get_checkout",
  arguments: { id: checkoutId },
});

const OPEN = new Set(["incomplete", "requires_escalation", "ready_for_complete"]);

// One idempotency key per payment attempt: the same checkout and card reuse it, so a retry after
// a lost answer pays once; another card or checkout is another attempt with a fresh key (the
// store refuses a reused key with a different body).
export type PayAttempt = { key: string; checkoutId: string; instrumentId: string };
export function attemptFor(
  previous: PayAttempt | undefined,
  checkoutId: string,
  instrumentId: string,
  key = newKey(),
): PayAttempt {
  return previous?.checkoutId === checkoutId && previous.instrumentId === instrumentId
    ? previous
    : { key, checkoutId, instrumentId };
}

// Only a card the checkout itself listed, only when the store says it is ready to pay.
export function payCall(bag: BagView, instrumentId: string, key: string): Call | undefined {
  if (bag.kind !== "checkout" || bag.status !== "ready_for_complete") return undefined;
  if (!bag.instruments.some((i) => i.id === instrumentId)) return undefined;
  return {
    name: "complete_checkout",
    arguments: {
      meta: meta(key),
      id: bag.id,
      checkout: {
        payment: {
          instruments: [
            { id: instrumentId, handler_id: "saved_card", type: "card", selected: true },
          ],
        },
      },
    },
  };
}

export const isOpen = (bag: BagView) => bag.kind === "cart" || OPEN.has(bag.status);

// --- what a button does ------------------------------------------------------------------------

export type Action = { kind: "call"; label: string; call: Call } | { kind: "none" };

// A button calls the store's tool itself; the widget never writes to the assistant.
export function choose(label: string, call: () => Call | undefined): Action {
  const made = call();
  return made ? { kind: "call", label, call: made } : { kind: "none" };
}

// What a button tells the model, so the conversation knows the cart or checkout id.
export function contextFor(bag: BagView) {
  const items = bag.lines.map((l) => `${l.quantity} × ${l.title}`).join(", ");
  const total = money(bag.total, bag.currency);
  if (bag.order)
    return `The shopper paid checkout ${bag.id} by hand: ${bag.order.label}, ${total}.`;
  return `The shopper changed their ${bag.kind} ${bag.id} by hand (status ${bag.status || "open"}): ${items}; total ${total}.`;
}

export function contextDataFor(bag: BagView): Record<string, unknown> {
  return {
    kind: bag.kind,
    id: bag.id,
    status: bag.status,
    currency: bag.currency,
    total: bag.total,
    items: bag.lines.map((l) => ({ id: l.variantId, title: l.title, quantity: l.quantity })),
    ...(bag.order ? { order: bag.order.label } : {}),
  };
}

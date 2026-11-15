// Spec: knowledge/components/adyen-agentic-commerce.md
// UCP 2026-08-25 shopping service: one operation table served over REST and over MCP.
import { PRODUCTS, type Product, productById, searchProducts, variantById, variantsOf } from "./catalog";
import * as commerce from "./commerce";
import { config, CURRENCY, UCP_VERSION } from "./config";
import { get } from "./db";
import type { Auth, Scope } from "./oauth";
import { isRecord } from "./util";

const SPEC = `https://ucp.dev/${UCP_VERSION}`;
export const HANDLER_KEY = "com.payments-playground.saved_card";
export const HANDLER_ID = "saved_card";

export function paymentHandler() {
  const origin = config().publicOrigin;
  return {
    id: HANDLER_ID,
    version: UCP_VERSION,
    spec: `${origin}/agents#saved-card-handler`,
    schema: `${origin}/ucp/v1/handlers/saved_card.json`,
    available_instruments: [{ type: "card" }],
    config: { environment: "test", required_scope: "ucp:pay", credential_type: "saved_card_alias" },
  };
}

export function handlerSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${config().publicOrigin}/ucp/v1/handlers/saved_card.json`,
    title: "Saved card instrument (Atelier Velune demo)",
    description: "Pick an instrument listed in checkout.payment.instruments; its id is an alias of the shopper's card saved with Adyen. The raw card token never leaves the merchant.",
    type: "object",
    required: ["id", "handler_id", "type"],
    properties: {
      id: { type: "string", pattern: "^card_[0-9a-f]{20}$" },
      handler_id: { const: HANDLER_ID },
      type: { const: "card" },
      credential: { type: "object", properties: { type: { const: "saved_card_alias" }, token: { type: "string" } } },
    },
  };
}

const CAPABILITIES = {
  "dev.ucp.shopping.catalog.search": "catalog_search",
  "dev.ucp.shopping.catalog.lookup": "catalog_lookup",
  "dev.ucp.shopping.cart": "cart",
  "dev.ucp.shopping.checkout": "checkout",
  "dev.ucp.shopping.order": "order",
} as const;

export function profile() {
  const origin = config().publicOrigin;
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          { version: UCP_VERSION, spec: `${SPEC}/specification/overview/`, transport: "rest", endpoint: `${origin}/ucp/v1`, schema: `${SPEC}/services/shopping/rest.openapi.json` },
          { version: UCP_VERSION, spec: `${SPEC}/specification/overview/`, transport: "mcp", endpoint: `${origin}/mcp`, schema: `${SPEC}/services/shopping/mcp.openrpc.json` },
        ],
      },
      capabilities: Object.fromEntries(
        Object.entries(CAPABILITIES).map(([name, file]) => [
          name,
          [{ version: UCP_VERSION, spec: `${SPEC}/specification/${file.split("_")[0]}/`, schema: `${SPEC}/schemas/shopping/${file}.json` }],
        ]),
      ),
      payment_handlers: { [HANDLER_KEY]: [paymentHandler()] },
    },
    keys: [],
  };
}

function envelope(capability: keyof typeof CAPABILITIES, status: "success" | "error" = "success") {
  return {
    version: UCP_VERSION,
    status,
    capabilities: { [capability]: [{ version: UCP_VERSION }] },
    payment_handlers: { [HANDLER_KEY]: [paymentHandler()] },
  };
}

// --- rendering ---------------------------------------------------------------------------------

const money = (amount: number) => ({ amount, currency: CURRENCY });
const artUrl = (variantId: string) => `${config().publicOrigin}/api/art/${variantId}.svg`;

export function renderProduct(p: Product) {
  const origin = config().publicOrigin;
  const variants = variantsOf(p);
  return {
    id: p.id,
    handle: p.id,
    title: p.title,
    description: p.description,
    url: `${origin}/products/${p.id}`,
    categories: [{ value: p.category, taxonomy: "atelier-velune" }],
    price_range: { min: money(p.price), max: money(p.price) },
    media: [{ type: "image", url: artUrl(variants[0]!.id), alt_text: p.title, width: 480, height: 480 }],
    tags: p.tags,
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.id,
      title: v.title,
      description: p.description,
      url: `${origin}/products/${p.id}?variant=${v.id}`,
      price: money(v.price),
      availability: { available: v.available, status: v.available ? "in_stock" : "out_of_stock" },
      options: [
        { name: "colour", id: v.colour.id, label: v.colour.label },
        { name: "size", label: v.size },
      ],
      media: [{ type: "image", url: artUrl(v.id), alt_text: v.title, width: 480, height: 480 }],
    })),
  };
}

function renderLines(lines: commerce.Line[]) {
  return commerce.price(lines).items.map(({ line, variant, amount }) => ({
    id: line.id,
    item: { id: variant.id, title: variant.title, price: variant.price, image_url: artUrl(variant.id) },
    quantity: line.quantity,
    totals: [
      { type: "subtotal", amount },
      { type: "total", amount },
    ],
  }));
}

function links() {
  const origin = config().publicOrigin;
  return [
    { type: "terms_of_service", url: `${origin}/legal#terms` },
    { type: "privacy_policy", url: `${origin}/legal#privacy` },
  ];
}

export function renderCart(cart: commerce.Cart) {
  return {
    ucp: envelope("dev.ucp.shopping.cart"),
    id: cart.id,
    status: cart.status,
    line_items: renderLines(cart.lines),
    buyer: cart.buyer,
    currency: CURRENCY,
    totals: commerce.totals(cart.lines),
    links: links(),
    messages: [],
  };
}

export async function renderCheckout(checkout: commerce.Checkout, auth?: Auth) {
  const origin = config().publicOrigin;
  const canSeeCards = auth?.token.scopes.includes("ucp:pay");
  const cards = canSeeCards ? await commerce.savedCards() : [];
  const assessment = commerce.assess(checkout, auth, cards);
  const order = checkout.orderId ? get<commerce.Order>("orders", checkout.orderId) : undefined;
  return {
    ucp: envelope("dev.ucp.shopping.checkout"),
    id: checkout.id,
    status: assessment.status,
    line_items: renderLines(checkout.lines),
    buyer: auth?.token.scopes.includes("profile") || !checkout.clientId ? checkout.buyer : undefined,
    currency: CURRENCY,
    totals: commerce.totals(checkout.lines),
    messages: assessment.messages,
    links: links(),
    expires_at: checkout.expiresAt,
    continue_url: `${origin}/checkout/${checkout.id}`,
    payment: cards.length
      ? {
        instruments: cards.map((card, index) => ({
          id: card.alias,
          handler_id: HANDLER_ID,
          type: "card",
          display: { brand: card.brand, last_digits: card.lastFour, expiry_month: card.expiryMonth, expiry_year: card.expiryYear },
          selected: index === 0,
        })),
      }
      : undefined,
    order: order ? { id: order.id, label: `Order ${order.id.slice(4, 12)}`, permalink_url: `${origin}/orders/${order.id}` } : undefined,
    ...(auth ? { agent_budget: { spend_limit: money(auth.grant.spendLimit), spent: money(auth.grant.spent) } } : {}),
  };
}

export function renderOrder(order: commerce.Order, withBuyer: boolean) {
  return {
    ucp: envelope("dev.ucp.shopping.order"),
    id: order.id,
    checkout_id: order.checkoutId,
    status: order.status,
    permalink_url: `${config().publicOrigin}/orders/${order.id}`,
    currency: order.currency,
    line_items: order.lines.map((l) => ({
      id: l.variantId,
      item: { id: l.variantId, title: l.title, price: l.unitPrice, image_url: artUrl(l.variantId) },
      quantity: l.quantity,
      totals: [{ type: "subtotal", amount: l.unitPrice * l.quantity }, { type: "total", amount: l.unitPrice * l.quantity }],
    })),
    totals: [
      { type: "subtotal", amount: order.subtotal },
      { type: "fulfillment", amount: order.fulfillment },
      { type: "total", amount: order.total },
    ],
    buyer: withBuyer ? order.buyer : undefined,
    payment: { status: order.status, psp_reference: order.pspReference, paid_by: order.paidBy },
    created_at: order.createdAt,
  };
}

// --- operations --------------------------------------------------------------------------------

export type OpContext = { auth?: Auth };
export type OpResult = { status: number; body: unknown };
export class ScopeError extends Error {
  constructor(readonly scope: Scope) {
    super(`The ${scope} scope is required`);
  }
}

function need(ctx: OpContext, scope: Scope) {
  if (ctx.auth && !ctx.auth.token.scopes.includes(scope)) throw new ScopeError(scope);
}

const idOf = (args: Record<string, unknown>) => {
  if (typeof args.id !== "string" || !args.id) throw new commerce.CommerceError(400, { type: "error", code: "missing_id", content: "id is required", severity: "unrecoverable" });
  return args.id;
};
const part = (args: Record<string, unknown>, key: string) => (isRecord(args[key]) ? args[key] as Record<string, unknown> : {});

export const OPERATIONS: Record<string, (args: Record<string, unknown>, ctx: OpContext) => Promise<OpResult> | OpResult> = {
  search_catalog: (args) => {
    const req = part(args, "catalog");
    const filters = isRecord(req.filters) ? req.filters : {};
    const category = typeof filters.category === "string" ? filters.category : undefined;
    const max = isRecord(filters.price) && typeof filters.price.max === "number" ? filters.price.max : undefined;
    const products = searchProducts(typeof req.query === "string" ? req.query : "", { category, maxPrice: max });
    return { status: 200, body: { ucp: envelope("dev.ucp.shopping.catalog.search"), products: products.map(renderProduct), messages: products.length ? [] : [{ type: "info", code: "no_results", content: `No match. Categories: clothing, bags, accessories. ${PRODUCTS.length} products in total.` }] } };
  },
  lookup_catalog: (args) => {
    const req = part(args, "catalog");
    const ids = Array.isArray(req.ids) ? req.ids.map(String).slice(0, 50) : [];
    const products = new Map<string, Product>();
    const inputs = new Map<string, string[]>();
    for (const id of ids) {
      const product = productById(id) ?? productById(variantById(id)?.productId ?? "");
      if (product) {
        products.set(product.id, product);
        inputs.set(product.id, [...(inputs.get(product.id) ?? []), id]);
      }
    }
    const missing = ids.filter((id) => !productById(id) && !variantById(id));
    return { status: 200, body: { ucp: envelope("dev.ucp.shopping.catalog.lookup"), products: [...products.values()].map(renderProduct), messages: missing.map((id) => ({ type: "error", code: "not_found", content: `No product or variant ${id}`, severity: "unrecoverable" })) } };
  },
  get_product: (args) => {
    const req = part(args, "catalog");
    const id = typeof req.id === "string" ? req.id : typeof args.id === "string" ? args.id : "";
    const product = productById(id) ?? productById(variantById(id)?.productId ?? "");
    if (!product) return { status: 404, body: { ucp: envelope("dev.ucp.shopping.catalog.lookup", "error"), messages: [{ type: "error", code: "not_found", content: `No product ${id}`, severity: "unrecoverable" }] } };
    return { status: 200, body: { ucp: envelope("dev.ucp.shopping.catalog.lookup"), product: renderProduct(product) } };
  },
  create_cart: (args, ctx) => {
    need(ctx, "ucp:checkout");
    return { status: 201, body: renderCart(commerce.createCart(part(args, "cart"), ctx.auth?.token.clientId)) };
  },
  get_cart: (args, ctx) => ({ status: 200, body: renderCart(commerce.loadCart(idOf(args), ctx.auth?.token.clientId)) }),
  update_cart: (args, ctx) => {
    need(ctx, "ucp:checkout");
    const cart = commerce.loadCart(idOf(args), ctx.auth?.token.clientId);
    return { status: 200, body: renderCart(commerce.updateCart(cart, part(args, "cart"))) };
  },
  cancel_cart: (args, ctx) => {
    need(ctx, "ucp:checkout");
    return { status: 200, body: renderCart(commerce.cancelCart(commerce.loadCart(idOf(args), ctx.auth?.token.clientId))) };
  },
  create_checkout: async (args, ctx) => {
    need(ctx, "ucp:checkout");
    return { status: 201, body: await renderCheckout(commerce.createCheckout(part(args, "checkout"), ctx.auth), ctx.auth) };
  },
  get_checkout: async (args, ctx) => ({ status: 200, body: await renderCheckout(commerce.loadCheckout(idOf(args), ctx.auth), ctx.auth) }),
  update_checkout: async (args, ctx) => {
    need(ctx, "ucp:checkout");
    const checkout = commerce.loadCheckout(idOf(args), ctx.auth);
    return { status: 200, body: await renderCheckout(commerce.updateCheckout(checkout, part(args, "checkout")), ctx.auth) };
  },
  complete_checkout: async (args, ctx) => {
    const checkout = commerce.loadCheckout(idOf(args), ctx.auth);
    return { status: 200, body: await renderCheckout(await commerce.completeCheckout(checkout, part(args, "checkout"), ctx.auth), ctx.auth) };
  },
  cancel_checkout: async (args, ctx) => {
    need(ctx, "ucp:checkout");
    return { status: 200, body: await renderCheckout(commerce.cancelCheckout(commerce.loadCheckout(idOf(args), ctx.auth)), ctx.auth) };
  },
  get_order: (args, ctx) => {
    const order = get<commerce.Order>("orders", idOf(args));
    const checkout = order ? get<commerce.Checkout>("checkouts", order.checkoutId) : undefined;
    if (!order || (checkout?.clientId && checkout.clientId !== ctx.auth?.token.clientId)) {
      throw new commerce.CommerceError(404, { type: "error", code: "not_found", content: "Order not found", severity: "unrecoverable" });
    }
    if (checkout?.clientId) need(ctx, "ucp:orders");
    return { status: 200, body: renderOrder(order, Boolean(ctx.auth?.token.scopes.includes("profile"))) };
  },
};

// Operations that change state need an Idempotency-Key; catalogue POSTs are reads.
export const MUTATIONS = new Set(["create_cart", "update_cart", "cancel_cart", "create_checkout", "update_checkout", "complete_checkout", "cancel_checkout"]);

export function routeRest(method: string, path: string): { op: string; args: Record<string, unknown>; bodyKey?: string } | undefined {
  const parts = path.split("/").filter(Boolean);
  const [a, b, c] = parts;
  if (method === "POST" && a === "catalog" && parts.length === 2) {
    const op = { search: "search_catalog", lookup: "lookup_catalog", product: "get_product" }[b ?? ""];
    return op ? { op, args: {}, bodyKey: "catalog" } : undefined;
  }
  const resource = a === "carts" ? "cart" : a === "checkout-sessions" ? "checkout" : a === "orders" ? "order" : undefined;
  if (!resource) return undefined;
  if (resource === "order") return method === "GET" && b && !c ? { op: "get_order", args: { id: b } } : undefined;
  if (!b) return method === "POST" ? { op: `create_${resource}`, args: {}, bodyKey: resource } : undefined;
  if (!c) {
    if (method === "GET") return { op: `get_${resource}`, args: { id: b } };
    if (method === "PUT") return { op: `update_${resource}`, args: { id: b }, bodyKey: resource };
    return undefined;
  }
  if (method === "POST" && c === "cancel") return { op: `cancel_${resource}`, args: { id: b } };
  if (method === "POST" && c === "complete" && resource === "checkout") return { op: "complete_checkout", args: { id: b }, bodyKey: "checkout" };
  return undefined;
}

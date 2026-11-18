// Spec: knowledge/components/adyen-agentic-commerce.md
// UCP 2026-08-25 shopping service: one operation table served over REST and over MCP.
import {
  type Product,
  productById,
  searchProducts,
  type Variant,
  variantById,
  variantsOf,
} from "./catalog";
import * as commerce from "./commerce";
import { config, CURRENCY, UCP_VERSION } from "./config";
import { customerById } from "./customers";
import { get } from "./db";
import { type Auth, allows, type Grant, type Scope, SCOPES } from "./oauth";
import { isRecord } from "./util";

const SPEC = `https://ucp.dev/${UCP_VERSION}`;
export const HANDLER_KEY = "com.payments-playground.saved_card";
export const HANDLER_ID = "saved_card";
export const NETWORK_TOKEN_KEY = "com.payments-playground.network_token";
export const NETWORK_TOKEN_ID = "network_token";

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

// ADR-015: an agent brings its own card as a network token's number and expiry, signed in or not;
// the store reads the brand from Adyen, pays once and keeps none of it.
export function networkTokenHandler() {
  const origin = config().publicOrigin;
  return {
    id: NETWORK_TOKEN_ID,
    version: UCP_VERSION,
    spec: `${origin}/agents#network-token-handler`,
    schema: `${origin}/ucp/v1/handlers/network_token.json`,
    available_instruments: [{ type: "card" }],
    config: { environment: "test", credential_type: "network_token", single_use: true },
  };
}

export function networkTokenSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${config().publicOrigin}/ucp/v1/handlers/network_token.json`,
    title: "Network token instrument (Atelier Velune demo)",
    description:
      "A network token's number and expiry, nothing else: no cryptogram, no CVC, no brand (the store reads the brand from Adyen). It is paid as an unscheduled card-on-file payment (ContAuth) and used once: the store never stores, logs or returns it. Other credential fields are ignored.",
    type: "object",
    required: ["handler_id", "type", "credential"],
    properties: {
      id: { type: "string" },
      handler_id: { const: NETWORK_TOKEN_ID },
      type: { const: "card" },
      credential: {
        type: "object",
        required: ["type", "number", "expiry_month", "expiry_year"],
        properties: {
          type: { const: "network_token" },
          number: { type: "string", pattern: "^[0-9]{13,19}$" },
          expiry_month: { type: "integer", minimum: 1, maximum: 12 },
          expiry_year: { type: "integer", minimum: 2000, maximum: 9999 },
          name: { type: "string", maxLength: 80 },
        },
      },
    },
  };
}

const paymentHandlers = () => ({
  [HANDLER_KEY]: [paymentHandler()],
  [NETWORK_TOKEN_KEY]: [networkTokenHandler()],
});

export function handlerSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${config().publicOrigin}/ucp/v1/handlers/saved_card.json`,
    title: "Saved card instrument (Atelier Velune demo)",
    description:
      "Pick an instrument listed in checkout.payment.instruments; its id is an alias of the shopper's card saved with Adyen. The raw card token never leaves the merchant.",
    type: "object",
    required: ["id", "handler_id", "type"],
    properties: {
      id: { type: "string", pattern: "^card_[0-9a-f]{20}$" },
      handler_id: { const: HANDLER_ID },
      type: { const: "card" },
      credential: {
        type: "object",
        properties: { type: { const: "saved_card_alias" }, token: { type: "string" } },
      },
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
          {
            version: UCP_VERSION,
            spec: `${SPEC}/specification/overview/`,
            transport: "rest",
            endpoint: `${origin}/ucp/v1`,
            schema: `${SPEC}/services/shopping/rest.openapi.json`,
          },
          {
            version: UCP_VERSION,
            spec: `${SPEC}/specification/overview/`,
            transport: "mcp",
            endpoint: `${origin}/mcp`,
            schema: `${SPEC}/services/shopping/mcp.openrpc.json`,
          },
        ],
      },
      capabilities: {
        ...Object.fromEntries(
          Object.entries(CAPABILITIES).map(([name, file]) => [
            name,
            [
              {
                version: UCP_VERSION,
                spec: `${SPEC}/specification/shopping/${file.split("_")[0]}/`,
                schema: `${SPEC}/schemas/shopping/${file}.json`,
              },
            ],
          ]),
        ),
        // config.scopes lists only the hard gates; scopes_supported in the OAuth metadata adds
        // the optional layer (UCP identity linking, "UCP and OAuth").
        "dev.ucp.common.identity_linking": [
          {
            version: UCP_VERSION,
            spec: `${SPEC}/specification/common/identity-linking/`,
            schema: `${SPEC}/schemas/common/identity_linking.json`,
            config: {
              scopes: Object.fromEntries(
                HARD_GATES.map((s) => [s, { description: { plain: SCOPES[s].label } }]),
              ),
            },
          },
        ],
      },
      payment_handlers: paymentHandlers(),
    },
    keys: [],
  };
}

type Capability = keyof typeof CAPABILITIES;
// The store's shopping capabilities, all at UCP_VERSION: what negotiation intersects.
export const STORE_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[];

// The capability each operation belongs to: it runs only when negotiation kept that capability.
export const OP_CAPABILITY: Readonly<Record<string, Capability>> = {
  search_catalog: "dev.ucp.shopping.catalog.search",
  lookup_catalog: "dev.ucp.shopping.catalog.lookup",
  get_product: "dev.ucp.shopping.catalog.lookup",
  create_cart: "dev.ucp.shopping.cart",
  get_cart: "dev.ucp.shopping.cart",
  update_cart: "dev.ucp.shopping.cart",
  cancel_cart: "dev.ucp.shopping.cart",
  create_checkout: "dev.ucp.shopping.checkout",
  get_checkout: "dev.ucp.shopping.checkout",
  update_checkout: "dev.ucp.shopping.checkout",
  complete_checkout: "dev.ucp.shopping.checkout",
  cancel_checkout: "dev.ucp.shopping.checkout",
  get_order: "dev.ucp.shopping.order",
};

// UCP continue_url on a failed negotiation: the page where the shopper can carry on by hand.
export function continueUrl(op: string) {
  const origin = config().publicOrigin;
  const capability = OP_CAPABILITY[op] ?? "";
  if (capability.startsWith("dev.ucp.shopping.catalog")) return `${origin}/shop`;
  if (capability === "dev.ucp.shopping.order") return `${origin}/`;
  return `${origin}/cart`;
}

// UCP's error_response for a negotiation that failed or shares no capability for `op`.
export function negotiationRefusal(op: string, code: string, content: string) {
  return {
    ucp: { version: UCP_VERSION, status: "error" },
    messages: [{ type: "error", code, content, severity: "unrecoverable" }],
    continue_url: continueUrl(op),
  };
}

export const capabilitiesIncompatible = (op: string) =>
  negotiationRefusal(
    op,
    "capabilities_incompatible",
    `${op} needs ${OP_CAPABILITY[op]} at ${UCP_VERSION}, which the platform profile does not share`,
  );

function envelope(capability: Capability, status: "success" | "error" = "success") {
  return {
    version: UCP_VERSION,
    status,
    capabilities: { [capability]: [{ version: UCP_VERSION }] },
    payment_handlers: paymentHandlers(),
  };
}

// --- rendering ---------------------------------------------------------------------------------

const money = (amount: number) => ({ amount, currency: CURRENCY });
const artUrl = (variantId: string) => `${config().publicOrigin}/api/art/${variantId}.svg`;

// UCP's selected_option: colour carries its value id, size has none.
type Selection = { name: "colour" | "size"; id?: string; label: string };
const OPTION_NAMES = ["colour", "size"] as const;

const optionsOf = (v: Variant): Selection[] => [
  { name: "colour", id: v.colour.id, label: v.colour.label },
  { name: "size", label: v.size },
];

// UCP prefers the value id over the label when the platform sends one.
const matches = (v: Variant, s: Selection) =>
  s.name === "colour"
    ? s.id !== undefined
      ? v.colour.id === s.id
      : v.colour.label === s.label
    : v.size === s.label;
const matchesAll = (v: Variant, selected: Selection[]) => selected.every((s) => matches(v, s));

// The featured variant is the first one a shopper can buy, else the first one.
const featured = (variants: Variant[]) => variants.find((v) => v.available) ?? variants[0];
const featuredFirst = (variants: Variant[]) => {
  const top = featured(variants);
  return top ? [top, ...variants.filter((v) => v !== top)] : [];
};

export function renderVariant(p: Product, v: Variant) {
  return {
    id: v.id,
    sku: v.id,
    title: v.title,
    description: { plain: p.description },
    url: `${config().publicOrigin}/products/${p.id}?variant=${v.id}`,
    price: money(v.price),
    availability: { available: v.available, status: v.available ? "in_stock" : "out_of_stock" },
    options: optionsOf(v),
    media: [{ type: "image", url: artUrl(v.id), alt_text: v.title, width: 480, height: 480 }],
  };
}

// `variants` is what this answer returns, in order: its first is the featured one.
export function renderProduct(p: Product, variants: Variant[] = featuredFirst(variantsOf(p))) {
  const all = variantsOf(p);
  const prices = all.map((v) => v.price);
  return {
    id: p.id,
    handle: p.id,
    title: p.title,
    description: { plain: p.description },
    url: `${config().publicOrigin}/products/${p.id}`,
    categories: [{ value: p.category, taxonomy: "atelier-velune" }],
    price_range: { min: money(Math.min(...prices)), max: money(Math.max(...prices)) },
    media: [
      {
        type: "image",
        url: artUrl((variants[0] ?? all[0]!).id),
        alt_text: p.title,
        width: 480,
        height: 480,
      },
    ],
    options: [
      { name: "colour", values: p.colours.map((c) => ({ id: c.id, label: c.label })) },
      { name: "size", values: p.sizes.map((label) => ({ label })) },
    ],
    tags: p.tags,
    variants: variants.map((v) => renderVariant(p, v)),
  };
}

// UCP search_filters, shared by search, lookup and product: categories (any of) on the product,
// a price range on each variant. The singular `category` this store read before stays accepted.
type Filters = { categories: string[]; min?: number; max?: number };

function readFilters(req: Record<string, unknown>): Filters {
  const filters = isRecord(req.filters) ? req.filters : {};
  const categories = Array.isArray(filters.categories)
    ? filters.categories.filter((c): c is string => typeof c === "string")
    : typeof filters.category === "string"
      ? [filters.category]
      : [];
  const price = isRecord(filters.price) ? filters.price : {};
  return {
    categories,
    min: typeof price.min === "number" ? price.min : undefined,
    max: typeof price.max === "number" ? price.max : undefined,
  };
}

const inCategory = (p: Product, f: Filters) =>
  !f.categories.length || f.categories.includes(p.category);
const inPriceRange = (v: Variant, f: Filters) =>
  (f.min === undefined || v.price >= f.min) && (f.max === undefined || v.price <= f.max);
const variantsWithin = (p: Product, f: Filters) =>
  inCategory(p, f) ? variantsOf(p).filter((v) => inPriceRange(v, f)) : [];

// UCP pagination: a default page of 10, at most 50, and an opaque stateless cursor (an offset).
const PAGE_DEFAULT = 10;
const PAGE_MAX = 50;
const LOOKUP_MAX = 50;

function readPage(req: Record<string, unknown>) {
  const pagination = isRecord(req.pagination) ? req.pagination : {};
  const { limit, cursor } = pagination;
  if (limit !== undefined && !(Number.isInteger(limit) && (limit as number) >= 1))
    throw invalidParams("invalid_pagination", "pagination.limit must be an integer of 1 or more");
  let offset = 0;
  if (cursor !== undefined) {
    const decoded =
      typeof cursor === "string" ? Buffer.from(cursor, "base64url").toString("utf8") : "";
    const found = /^o:(0|[1-9][0-9]{0,5})$/.exec(decoded);
    if (!found) throw invalidParams("invalid_pagination", "pagination.cursor is not one we issued");
    offset = Number(found[1]);
  }
  return { offset, limit: Math.min((limit as number | undefined) ?? PAGE_DEFAULT, PAGE_MAX) };
}

const cursorFor = (offset: number) => Buffer.from(`o:${offset}`).toString("base64url");

// Product detail (UCP get_product): the effective selection, after dropping what no variant
// matches; options not in `preferences` go first, then preferences from the end.
function readSelection(req: Record<string, unknown>): Selection[] {
  const asked = Array.isArray(req.selected) ? req.selected.filter(isRecord) : [];
  const seen = new Set<string>();
  const selection: Selection[] = [];
  for (const s of asked) {
    const name = s.name;
    if (name !== "colour" && name !== "size") continue;
    if (seen.has(name) || typeof s.label !== "string") continue;
    seen.add(name);
    selection.push({ name, label: s.label, ...(typeof s.id === "string" ? { id: s.id } : {}) });
  }
  return selection;
}

function relax(selection: Selection[], preferences: string[], candidates: Variant[]) {
  const order = [
    ...selection
      .map((s) => s.name)
      .filter((n) => !preferences.includes(n))
      .reverse(),
    ...[...preferences].reverse(),
  ];
  let effective = selection;
  for (const name of order) {
    if (candidates.some((v) => matchesAll(v, effective))) break;
    effective = effective.filter((s) => s.name !== name);
  }
  return effective;
}

// Normalised to the catalogue's own values, in option order.
function selectionFor(effective: Selection[], anchor: Variant): Selection[] {
  return optionsOf(anchor).filter((o) => effective.some((s) => s.name === o.name));
}

function detailOptions(p: Product, selected: Selection[], candidates: Variant[]) {
  const all = variantsOf(p);
  const signal = (value: Selection) => {
    const others = selected.filter((s) => s.name !== value.name);
    const wanted = [...others, value];
    return {
      available: candidates.some((v) => v.available && matchesAll(v, wanted)),
      exists: all.some((v) => matchesAll(v, wanted)),
    };
  };
  return OPTION_NAMES.map((name) => ({
    name,
    values:
      name === "colour"
        ? p.colours.map((c) => ({
            id: c.id,
            label: c.label,
            ...signal({ name, id: c.id, label: c.label }),
          }))
        : p.sizes.map((label) => ({ label, ...signal({ name, label }) })),
  }));
}

function renderLines(lines: commerce.Line[]) {
  return commerce.price(lines).items.map(({ line, variant, amount }) => ({
    id: line.id,
    item: {
      id: variant.id,
      title: variant.title,
      price: variant.price,
      image_url: artUrl(variant.id),
    },
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
  const canSeeCards = auth !== undefined && allows(auth.token.scopes, "ucp:pay");
  // The grant's own account, if it still exists: an agent sees no one else's cards.
  const account = canSeeCards ? customerById(auth.grant.customerId) : undefined;
  const cards = account ? await commerce.savedCards(account.id) : [];
  const assessment = commerce.assess(checkout, auth, cards);
  const order = checkout.orderId ? get<commerce.Order>("orders", checkout.orderId) : undefined;
  // UCP's identity_optional: a guest may pay with its own network token or hand the shopper
  // continue_url; signing in adds the account's saved cards.
  const open = ["incomplete", "requires_escalation", "ready_for_complete"].includes(
    assessment.status,
  );
  const signals =
    !auth && open
      ? [
          {
            type: "info",
            code: "identity_optional",
            content:
              "Complete with your own network token (number and expiry), sign in to pay with the shopper's saved card within a spend limit they set, or complete with no instrument to hand the shopper continue_url.",
          },
        ]
      : [];
  return {
    ucp: envelope("dev.ucp.shopping.checkout"),
    id: checkout.id,
    status: assessment.status,
    line_items: renderLines(checkout.lines),
    buyer:
      (auth && allows(auth.token.scopes, "profile")) || !checkout.clientId
        ? checkout.buyer
        : undefined,
    currency: CURRENCY,
    totals: commerce.totals(checkout.lines),
    messages: [...assessment.messages, ...signals],
    links: links(),
    expires_at: checkout.expiresAt,
    continue_url: `${origin}/checkout/${checkout.id}`,
    payment: cards.length
      ? {
          instruments: cards.map((card, index) => ({
            id: card.alias,
            handler_id: HANDLER_ID,
            type: "card",
            display: {
              brand: card.brand,
              last_digits: card.lastFour,
              expiry_month: card.expiryMonth,
              expiry_year: card.expiryYear,
            },
            selected: index === 0,
          })),
        }
      : undefined,
    order: order
      ? {
          id: order.id,
          label: `Order ${order.id.slice(4, 12)}`,
          permalink_url: `${origin}/orders/${order.id}`,
        }
      : undefined,
    ...(auth ? { agent_budget: budgetOf(auth) } : {}),
  };
}

// Read again here, not taken from the request's auth: a completion has just charged the grant, and
// the shopper may have changed its limit since the token was checked.
function budgetOf(auth: Auth) {
  const grant = get<Grant>("grants", auth.grant.id) ?? auth.grant;
  return {
    spend_limit: money(grant.spendLimit),
    spent: money(grant.spent),
    remaining: money(Math.max(grant.spendLimit - grant.spent, 0)),
    manage_url: commerce.budgetUrl(grant.id),
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
    // Nothing ships in this demo: every line stays processing and the fulfilment log is empty.
    line_items: order.lines.map((l) => ({
      id: l.variantId,
      item: { id: l.variantId, title: l.title, price: l.unitPrice, image_url: artUrl(l.variantId) },
      quantity: { original: l.quantity, total: l.quantity, fulfilled: 0 },
      totals: [
        { type: "subtotal", amount: l.unitPrice * l.quantity },
        { type: "total", amount: l.unitPrice * l.quantity },
      ],
      status: "processing",
    })),
    fulfillment: { expectations: [], events: [] },
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
// rpcCode: a request MCP must refuse as a JSON-RPC error rather than a tool result.
export type OpResult = { status: number; body: unknown; rpcCode?: number };

// UCP answers a malformed or oversized catalogue request with 400 on REST and -32602 on MCP.
export class InvalidParams extends commerce.CommerceError {}
const invalidParams = (code: string, content: string) =>
  new InvalidParams(400, { type: "error", code, content, severity: "unrecoverable" });

// UCP identity linking: the one scope each operation needs, declared once for the check below and
// for the OpenAPI description. Reads of a cart or checkout by its id and the catalogue need none.
export const REQUIRED_SCOPE: Readonly<Record<string, Scope>> = {
  create_cart: "dev.ucp.shopping.cart:manage",
  update_cart: "dev.ucp.shopping.cart:manage",
  cancel_cart: "dev.ucp.shopping.cart:manage",
  create_checkout: "dev.ucp.shopping.checkout:manage",
  update_checkout: "dev.ucp.shopping.checkout:manage",
  complete_checkout: "dev.ucp.shopping.checkout:manage",
  cancel_checkout: "dev.ucp.shopping.checkout:manage",
  get_order: "dev.ucp.shopping.order:read",
};

// The profile's config.scopes: these need a token at all. The other scopes are UCP's optional
// layer, checked only on a token that is present, so guest carts and checkouts keep working.
export const HARD_GATES: readonly Scope[] = ["dev.ucp.shopping.order:read"];

// A token that lacks the operation's scope: 403 insufficient_scope.
export class ScopeError extends Error {
  constructor(readonly scope: Scope) {
    super(`This operation requires scopes: ${scope}`);
  }
}

// No token on a hard-gated operation: 401 identity_required.
export class IdentityRequired extends Error {
  constructor(readonly scope: Scope) {
    super("Sign in to read the orders your agent placed");
  }
}

function need(ctx: OpContext, op: string) {
  const scope = REQUIRED_SCOPE[op];
  if (!scope) return;
  if (!ctx.auth) {
    if (HARD_GATES.includes(scope)) throw new IdentityRequired(scope);
    return;
  }
  if (!allows(ctx.auth.token.scopes, scope)) throw new ScopeError(scope);
}

const idOf = (args: Record<string, unknown>) => {
  if (typeof args.id !== "string" || !args.id)
    throw new commerce.CommerceError(400, {
      type: "error",
      code: "missing_id",
      content: "id is required",
      severity: "unrecoverable",
    });
  return args.id;
};
const part = (args: Record<string, unknown>, key: string) =>
  isRecord(args[key]) ? (args[key] as Record<string, unknown>) : {};

type Operation = (args: Record<string, unknown>, ctx: OpContext) => Promise<OpResult> | OpResult;

const HANDLERS: Record<string, Operation> = {
  search_catalog: (args) => {
    const req = part(args, "catalog");
    const filters = readFilters(req);
    const { offset, limit } = readPage(req);
    const found = searchProducts(typeof req.query === "string" ? req.query : "")
      .map((p) => ({ p, variants: variantsWithin(p, filters) }))
      .filter((hit) => hit.variants.length > 0);
    const page = found.slice(offset, offset + limit);
    const next = offset + limit < found.length;
    return {
      status: 200,
      body: {
        ucp: envelope("dev.ucp.shopping.catalog.search"),
        products: page.map(({ p, variants }) => renderProduct(p, featuredFirst(variants))),
        pagination: {
          has_next_page: next,
          ...(next ? { cursor: cursorFor(offset + limit) } : {}),
          total_count: found.length,
        },
        messages: found.length
          ? []
          : [
              {
                type: "info",
                code: "no_results",
                content: "No match. Categories: clothing, bags, accessories.",
              },
            ],
      },
    };
  },
  // UCP lookup: each product once, carrying only the variants an id resolved to, each with the
  // ids that resolved to it (`exact` for a variant id, `featured` for a product id).
  lookup_catalog: (args) => {
    const req = part(args, "catalog");
    const ids = [
      ...new Set(
        (Array.isArray(req.ids) ? req.ids : []).filter((x): x is string => typeof x === "string"),
      ),
    ];
    if (ids.length > LOOKUP_MAX)
      throw invalidParams("request_too_large", `At most ${LOOKUP_MAX} distinct ids per lookup`);
    const filters = readFilters(req);
    // Keyed by id: variantsOf builds fresh objects on every call.
    type Hit = { v: Variant; inputs: object[] };
    const resolved = new Map<string, { p: Product; hits: Map<string, Hit> }>();
    const missing: string[] = [];
    for (const id of ids) {
      const variant = variantById(id);
      const p = productById(id) ?? productById(variant?.productId ?? "");
      if (!p) {
        missing.push(id);
        continue;
      }
      const within = variantsWithin(p, filters);
      const hit = variant ? within.find((v) => v.id === variant.id) : featured(within);
      if (!hit) continue;
      const entry = resolved.get(p.id) ?? { p, hits: new Map<string, Hit>() };
      const seen = entry.hits.get(hit.id) ?? { v: hit, inputs: [] };
      seen.inputs.push({ id, match: variant ? "exact" : "featured" });
      entry.hits.set(hit.id, seen);
      resolved.set(p.id, entry);
    }
    return {
      status: 200,
      body: {
        ucp: envelope("dev.ucp.shopping.catalog.lookup"),
        products: [...resolved.values()].map(({ p, hits }) => {
          const found = [...hits.values()];
          return {
            ...renderProduct(
              p,
              found.map((h) => h.v),
            ),
            variants: found.map((h) => ({ ...renderVariant(p, h.v), inputs: h.inputs })),
          };
        }),
        messages: missing.map((id) => ({ type: "info", code: "not_found", content: id })),
      },
    };
  },
  // UCP get_product: the requested variant first, `selected` and the variants matching it, and
  // option values with availability against `selected`. Not found is an application outcome.
  get_product: (args) => {
    const req = part(args, "catalog");
    const id = typeof req.id === "string" ? req.id : typeof args.id === "string" ? args.id : "";
    const variant = variantById(id);
    const p = productById(id) ?? productById(variant?.productId ?? "");
    const candidates = p ? variantsWithin(p, readFilters(req)) : [];
    const anchor = variant ? candidates.find((v) => v.id === variant.id) : undefined;
    if (!p || !candidates.length || (variant && !anchor))
      return {
        status: 200,
        body: {
          ucp: envelope("dev.ucp.shopping.catalog.lookup", "error"),
          messages: [
            {
              type: "error",
              code: "not_found",
              content: `No product ${id}`,
              severity: "unrecoverable",
            },
          ],
        },
      };
    let selected: Selection[];
    let variants: Variant[];
    if (anchor) {
      selected = optionsOf(anchor);
      variants = [anchor, ...candidates.filter((v) => v !== anchor && matchesAll(v, selected))];
    } else {
      const asked = readSelection(req);
      const preferences = Array.isArray(req.preferences)
        ? req.preferences.filter((x): x is string => typeof x === "string")
        : [];
      const effective = asked.length ? relax(asked, preferences, candidates) : [];
      const matching = featuredFirst(candidates.filter((v) => matchesAll(v, effective)));
      selected = asked.length ? selectionFor(effective, matching[0]!) : optionsOf(matching[0]!);
      variants = matching.filter((v) => matchesAll(v, selected));
    }
    return {
      status: 200,
      body: {
        ucp: envelope("dev.ucp.shopping.catalog.lookup"),
        product: {
          ...renderProduct(p, variants),
          selected,
          options: detailOptions(p, selected, candidates),
        },
      },
    };
  },
  create_cart: (args, ctx) => {
    return {
      status: 201,
      body: renderCart(commerce.createCart(part(args, "cart"), ctx.auth)),
    };
  },
  get_cart: (args, ctx) => ({
    status: 200,
    body: renderCart(commerce.loadCart(idOf(args), ctx.auth)),
  }),
  update_cart: (args, ctx) => {
    const cart = commerce.loadCart(idOf(args), ctx.auth);
    return { status: 200, body: renderCart(commerce.updateCart(cart, part(args, "cart"))) };
  },
  cancel_cart: (args, ctx) => {
    return {
      status: 200,
      body: renderCart(commerce.cancelCart(commerce.loadCart(idOf(args), ctx.auth))),
    };
  },
  create_checkout: async (args, ctx) => {
    return {
      status: 201,
      body: await renderCheckout(
        commerce.createCheckout(part(args, "checkout"), ctx.auth),
        ctx.auth,
      ),
    };
  },
  get_checkout: async (args, ctx) => ({
    status: 200,
    body: await renderCheckout(commerce.loadCheckout(idOf(args), ctx.auth), ctx.auth),
  }),
  update_checkout: async (args, ctx) => {
    const checkout = commerce.loadCheckout(idOf(args), ctx.auth);
    return {
      status: 200,
      body: await renderCheckout(
        commerce.updateCheckout(checkout, part(args, "checkout")),
        ctx.auth,
      ),
    };
  },
  complete_checkout: async (args, ctx) => {
    const checkout = commerce.loadCheckout(idOf(args), ctx.auth);
    return {
      status: 200,
      body: await renderCheckout(
        await commerce.completeCheckout(checkout, part(args, "checkout"), ctx.auth),
        ctx.auth,
      ),
    };
  },
  cancel_checkout: async (args, ctx) => {
    return {
      status: 200,
      body: await renderCheckout(
        commerce.cancelCheckout(commerce.loadCheckout(idOf(args), ctx.auth)),
        ctx.auth,
      ),
    };
  },
  // Behind its hard gate: an agent reads only the orders it placed for the account it acts for;
  // any other id is not found. Orders before v0.4.0 carry their client on the checkout alone.
  get_order: (args, ctx) => {
    const order = get<commerce.Order>("orders", idOf(args));
    const checkout = order ? get<commerce.Checkout>("checkouts", order.checkoutId) : undefined;
    const placedBy = order?.clientId ? order : checkout;
    if (
      !order ||
      !ctx.auth ||
      !placedBy?.clientId ||
      placedBy.clientId !== ctx.auth.token.clientId ||
      placedBy.customerId !== ctx.auth.grant.customerId
    ) {
      throw new commerce.CommerceError(404, {
        type: "error",
        code: "not_found",
        content: "Order not found",
        severity: "unrecoverable",
      });
    }
    return {
      status: 200,
      body: renderOrder(order, allows(ctx.auth.token.scopes, "profile")),
    };
  },
};

// Every operation checks its scope before it runs, so the check cannot be forgotten on one.
export const OPERATIONS: Readonly<Record<string, Operation>> = Object.fromEntries(
  Object.entries(HANDLERS).map(([op, run]) => [
    op,
    (args: Record<string, unknown>, ctx: OpContext) => {
      need(ctx, op);
      return run(args, ctx);
    },
  ]),
);

// Operations that change state need an Idempotency-Key; catalogue POSTs are reads.
export const MUTATIONS = new Set([
  "create_cart",
  "update_cart",
  "cancel_cart",
  "create_checkout",
  "update_checkout",
  "complete_checkout",
  "cancel_checkout",
]);

export function routeRest(
  method: string,
  path: string,
): { op: string; args: Record<string, unknown>; bodyKey?: string } | undefined {
  const parts = path.split("/").filter(Boolean);
  const [a, b, c] = parts;
  if (method === "POST" && a === "catalog" && parts.length === 2) {
    const op = { search: "search_catalog", lookup: "lookup_catalog", product: "get_product" }[
      b ?? ""
    ];
    return op ? { op, args: {}, bodyKey: "catalog" } : undefined;
  }
  const resource =
    a === "carts"
      ? "cart"
      : a === "checkout-sessions"
        ? "checkout"
        : a === "orders"
          ? "order"
          : undefined;
  if (!resource) return undefined;
  if (resource === "order")
    return method === "GET" && b && !c ? { op: "get_order", args: { id: b } } : undefined;
  if (!b)
    return method === "POST"
      ? { op: `create_${resource}`, args: {}, bodyKey: resource }
      : undefined;
  if (!c) {
    if (method === "GET") return { op: `get_${resource}`, args: { id: b } };
    if (method === "PUT") return { op: `update_${resource}`, args: { id: b }, bodyKey: resource };
    return undefined;
  }
  if (method === "POST" && c === "cancel") return { op: `cancel_${resource}`, args: { id: b } };
  if (method === "POST" && c === "complete" && resource === "checkout")
    return { op: "complete_checkout", args: { id: b }, bodyKey: "checkout" };
  return undefined;
}

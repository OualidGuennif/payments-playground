// Spec: knowledge/components/adyen-agentic-commerce.md
// WebMCP (W3C draft of 2026-11-13; Chrome origin trial from 149): the store's own pages offer an
// agent in the shopper's browser the catalogue and the shopper's cart, through the same calls as
// the buttons. Paying stays with the shopper in Drop-in: no tool pays, and the account, consent,
// device and Back Office pages register none. The /mcp server is separate and unchanged.

export type JsonSchema = Record<string, unknown>;

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
};

export type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (input: Record<string, unknown>, client?: { signal?: AbortSignal }) => Promise<unknown>;
};

// The part of the draft's ModelContext this page uses. registerTool resolves once the tool is
// registered and the signal unregisters it; unregisterTool is only on earlier Chrome builds.
export type ModelContext = {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
};

export type CatalogVariant = { id: string; colour: string; size: string; available: boolean };
export type CatalogProduct = {
  id: string;
  title: string;
  category: string;
  price: number;
  variants: CatalogVariant[];
};
export type CartLine = { variantId: string; quantity: number };

export type ShopDeps = {
  catalog(
    filters: { q?: string; category?: string; maxPrice?: number },
    signal?: AbortSignal,
  ): Promise<CatalogProduct[]>;
  cart: {
    read(): CartLine[];
    add(variantId: string, quantity: number): CartLine[];
    setQuantity(variantId: string, quantity: number): CartLine[];
    clear(): void;
  };
  // The cart page's own call; the checkout id, or undefined when the server refused.
  createCheckout(lines: CartLine[], email?: string): Promise<string | undefined>;
  navigate(path: string): void;
  origin: string;
};

// The shopper's own pages: an agent in the page must not act on consent, account or orders.
const SHOPPER_ONLY = ["/account", "/consent", "/device", "/back-office"];
export const toolsAllowedOn = (path: string) =>
  !SHOPPER_ONLY.some((p) => path === p || path.startsWith(`${p}/`));

const CATEGORIES = ["clothing", "bags", "accessories"];
const MAX_QUANTITY = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : undefined;
const whole = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const unique = (values: string[]) => [...new Set(values)];
const items = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);
const eur = (minor: number) => minor / 100;

function summary(p: CatalogProduct) {
  const available = p.variants.filter((v) => v.available);
  return {
    product_id: p.id,
    title: p.title,
    price_eur: eur(p.price),
    colours: unique(available.map((v) => v.colour)),
    sizes: unique(available.map((v) => v.size)),
  };
}

const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
const CHANGES_CART: ToolAnnotations = { readOnlyHint: false };

export function shopTools(deps: ShopDeps): WebMcpTool[] {
  return [
    {
      name: "search_catalog",
      title: "Search the catalogue",
      description:
        "Search Atelier Velune's clothes, bags and accessories. Returns product ids, prices in euros and the colours and sizes in stock, for add_to_cart. An empty query lists everything.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words to match, such as 'linen coat'." },
          category: { type: "string", enum: CATEGORIES, description: "Only this category." },
          max_price_eur: { type: "number", minimum: 0, description: "Highest price, in euros." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "At most this many." },
        },
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      async execute(input, client) {
        const max = typeof input.max_price_eur === "number" ? input.max_price_eur : undefined;
        const limit = whole(input.limit, 1, 20) ?? 8;
        const products = await deps.catalog(
          {
            q: text(input.query),
            category: CATEGORIES.find((c) => c === input.category),
            maxPrice: max !== undefined && max >= 0 ? Math.round(max * 100) : undefined,
          },
          client?.signal,
        );
        return {
          products: products.slice(0, limit).map(summary),
          more: Math.max(0, products.length - limit),
        };
      },
    },
    {
      name: "view_cart",
      title: "View the cart",
      description:
        "The shopper's cart on this site: each line's variant id, title, quantity and unit price in euros, and the subtotal. The checkout adds shipping and computes the final total.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY,
      async execute(_input, client) {
        const lines = deps.cart.read();
        if (!lines.length) return { lines: [], items: 0, subtotal_eur: 0 };
        const variants = new Map(
          (await deps.catalog({}, client?.signal)).flatMap((p) =>
            p.variants.map((v) => [v.id, { title: `${p.title}, ${v.colour}, ${v.size}`, p }]),
          ),
        );
        const known = lines.filter((l) => variants.has(l.variantId));
        return {
          lines: known.map((l) => ({
            variant_id: l.variantId,
            title: variants.get(l.variantId)!.title,
            quantity: l.quantity,
            price_eur: eur(variants.get(l.variantId)!.p.price),
          })),
          items: items(known),
          subtotal_eur: eur(
            known.reduce((sum, l) => sum + variants.get(l.variantId)!.p.price * l.quantity, 0),
          ),
        };
      },
    },
    {
      name: "add_to_cart",
      title: "Add to the cart",
      description:
        "Add a product to the shopper's cart in a colour and size from search_catalog. Without a colour or size the product has several of, nothing is added and the choices come back.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "A product_id from search_catalog." },
          colour: { type: "string", description: "A colour name, such as 'Black'." },
          size: { type: "string", description: "A size, such as 'M' or 'One size'." },
          quantity: { type: "integer", minimum: 1, maximum: 10, description: "1 to 10." },
        },
        required: ["product_id"],
        additionalProperties: false,
      },
      annotations: CHANGES_CART,
      async execute(input, client) {
        const product = (await deps.catalog({}, client?.signal)).find(
          (p) => p.id === input.product_id,
        );
        if (!product) return { added: false, reason: "unknown_product" };
        const colours = unique(product.variants.map((v) => v.colour));
        const sizes = unique(product.variants.map((v) => v.size));
        const colour = text(input.colour) ?? (colours.length === 1 ? colours[0] : undefined);
        const size = text(input.size) ?? (sizes.length === 1 ? sizes[0] : undefined);
        if (!colour || !colours.some((c) => same(c, colour)))
          return { added: false, reason: "choose_colour", colours };
        if (!size || !sizes.some((s) => same(s, size)))
          return { added: false, reason: "choose_size", sizes };
        const variant = product.variants.find((v) => same(v.colour, colour) && same(v.size, size))!;
        if (!variant.available)
          return {
            added: false,
            reason: "sold_out",
            in_stock: product.variants
              .filter((v) => v.available)
              .map((v) => `${v.colour} ${v.size}`),
          };
        const cart = deps.cart.add(variant.id, whole(input.quantity, 1, MAX_QUANTITY) ?? 1);
        return {
          added: true,
          variant_id: variant.id,
          in_cart: cart.find((l) => l.variantId === variant.id)?.quantity ?? 0,
          cart_items: items(cart),
        };
      },
    },
    {
      name: "update_cart_item",
      title: "Change a cart line",
      description:
        "Set the quantity of a line in the shopper's cart, by its variant id from view_cart. Quantity 0 removes the line.",
      inputSchema: {
        type: "object",
        properties: {
          variant_id: { type: "string", description: "A variant_id from view_cart." },
          quantity: { type: "integer", minimum: 0, maximum: 10, description: "0 removes it." },
        },
        required: ["variant_id", "quantity"],
        additionalProperties: false,
      },
      annotations: CHANGES_CART,
      async execute(input) {
        const quantity = whole(input.quantity, 0, MAX_QUANTITY);
        if (quantity === undefined) return { updated: false, reason: "quantity_0_to_10" };
        const lines = deps.cart.read();
        if (!lines.some((l) => l.variantId === input.variant_id))
          return {
            updated: false,
            reason: "not_in_cart",
            variant_ids: lines.map((l) => l.variantId),
          };
        const next = deps.cart.setQuantity(String(input.variant_id), quantity);
        return { updated: true, removed: quantity === 0, cart_items: items(next) };
      },
    },
    {
      name: "start_checkout",
      title: "Go to checkout",
      description:
        "Turn the shopper's cart into a checkout and open its page, as the cart's Checkout button does. The shopper reviews it and pays there with Adyen Drop-in; no tool can pay.",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "The shopper's email for the receipt, if known." },
        },
        additionalProperties: false,
      },
      annotations: CHANGES_CART,
      async execute(input, client) {
        const email = text(input.email);
        if (email && !EMAIL.test(email)) return { started: false, reason: "invalid_email" };
        const known = new Set(
          (await deps.catalog({}, client?.signal)).flatMap((p) => p.variants.map((v) => v.id)),
        );
        const lines = deps.cart.read().filter((l) => known.has(l.variantId));
        if (!lines.length) return { started: false, reason: "empty_cart" };
        const id = await deps.createCheckout(lines, email);
        if (!id) return { started: false, reason: "refused" };
        deps.cart.clear();
        deps.navigate(`/checkout/${id}`);
        return {
          started: true,
          checkout_id: id,
          url: `${deps.origin}/checkout/${id}`,
          next: "The shopper now sees the checkout and pays there.",
        };
      },
    },
  ];
}

// All or none: if one registration fails, aborting the shared signal unregisters the others.
export async function registerAll(
  context: ModelContext,
  tools: WebMcpTool[],
  controller: AbortController,
): Promise<boolean> {
  const { signal } = controller;
  if (context.unregisterTool) unregisterOnAbort(context, tools, signal);
  try {
    await Promise.all(tools.map((tool) => context.registerTool(tool, { signal })));
    return !signal.aborted;
  } catch {
    controller.abort();
    return false;
  }
}

// Earlier builds unregister by name; the same abort then removes the tools there too.
function unregisterOnAbort(context: ModelContext, tools: WebMcpTool[], signal: AbortSignal) {
  signal.addEventListener(
    "abort",
    () => {
      for (const tool of tools) {
        try {
          context.unregisterTool?.(tool.name);
        } catch {
          /* already gone */
        }
      }
    },
    { once: true },
  );
}

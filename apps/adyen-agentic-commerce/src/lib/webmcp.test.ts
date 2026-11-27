// The page's WebMCP tools: the draft's naming rules and Chrome's size budgets, all-or-none
// registration, none on the shopper's own pages, no payment, and the same cart and checkout calls
// as the buttons, run against the real API.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { originTrialToken } from "../proxy";
import { handle } from "../server/api";
import { PRODUCTS } from "../server/catalog/catalog";
import { loadCheckout } from "../server/commerce/commerce";
import { freshStore, ORIGIN } from "../server/testing/agent";
import { addToCart, clearCart, readCart, setCartQuantity } from "./client";
import {
  type CatalogProduct,
  type JsonSchema,
  type ModelContext,
  registerAll,
  type ShopDeps,
  shopTools,
  toolsAllowedOn,
  type WebMcpTool,
} from "./webmcp";

// The browser globals the cart writes to, restored afterwards for the other test files.
const saved = { window: globalThis.window, localStorage: globalThis.localStorage };
const storage = new Map<string, string>();
beforeAll(() => {
  Object.assign(globalThis, {
    window: new EventTarget(),
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    },
  });
});
afterAll(() => Object.assign(globalThis, saved));

let navigated: string[];
let deps: ShopDeps;
let tools: Record<string, WebMcpTool>;

beforeEach(() => {
  freshStore();
  storage.clear();
  navigated = [];
  deps = {
    async catalog(filters) {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.category) params.set("category", filters.category);
      if (filters.maxPrice !== undefined) params.set("max_price", String(filters.maxPrice));
      const response = await handle(new Request(`${ORIGIN}/api/catalog?${params}`));
      return ((await response.json()) as { products: CatalogProduct[] }).products;
    },
    cart: { read: readCart, add: addToCart, setQuantity: setCartQuantity, clear: clearCart },
    async createCheckout(lines, email) {
      const response = await handle(
        new Request(`${ORIGIN}/api/checkouts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines, email: email ?? "shopper@example.com" }),
        }),
      );
      const body = (await response.json()) as { id?: string };
      return response.ok ? body.id : undefined;
    },
    navigate: (path) => void navigated.push(path),
    origin: ORIGIN,
  };
  tools = Object.fromEntries(shopTools(deps).map((t) => [t.name, t]));
});

// The JSON Schema keywords the output schemas use, and a checker for exactly those: the draft lets
// an agent reject an answer that does not validate against the tool's outputSchema.
const KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "const",
  "minimum",
  "oneOf",
  "format",
  "description",
]);
const TYPES: Record<string, (v: unknown) => boolean> = {
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
};

function keywordsKnown(schema: JsonSchema): boolean {
  const s = schema as Record<string, any>;
  return (
    Object.keys(s).every((k) => KEYWORDS.has(k)) &&
    (!s.type || s.type in TYPES) &&
    Object.values((s.properties ?? {}) as Record<string, JsonSchema>).every(keywordsKnown) &&
    (!s.items || keywordsKnown(s.items)) &&
    ((s.oneOf ?? []) as JsonSchema[]).every(keywordsKnown)
  );
}

function violations(schema: JsonSchema, value: unknown, at = "$"): string[] {
  const s = schema as Record<string, any>;
  const out: string[] = [];
  if ("const" in s && value !== s.const) out.push(`${at} is not ${JSON.stringify(s.const)}`);
  if (s.type && !TYPES[s.type]!(value)) return [...out, `${at} is not ${s.type}`];
  if (typeof value === "number" && s.minimum !== undefined && value < s.minimum)
    out.push(`${at} is under ${s.minimum}`);
  if (s.format === "uri" && !URL.canParse(String(value))) out.push(`${at} is not a URI`);
  if (s.type === "object") {
    const object = value as Record<string, unknown>;
    for (const key of s.required ?? []) if (!(key in object)) out.push(`${at}.${key} is missing`);
    for (const [key, item] of Object.entries(object)) {
      if (s.properties?.[key]) out.push(...violations(s.properties[key], item, `${at}.${key}`));
      else if (s.additionalProperties === false) out.push(`${at}.${key} is not allowed`);
    }
  }
  if (s.type === "array" && s.items)
    (value as unknown[]).forEach((item, i) => {
      out.push(...violations(s.items, item, `${at}[${i}]`));
    });
  if (s.oneOf) {
    const matched = (s.oneOf as JsonSchema[]).filter((b) => !violations(b, value, at).length);
    if (matched.length !== 1) out.push(`${at} matches ${matched.length} of oneOf`);
  }
  return out;
}

// Every answer in these tests is checked, as JSON, against the schema its tool declares.
async function run(name: string, input: Record<string, unknown> = {}) {
  const tool = tools[name]!;
  const answer = JSON.parse(JSON.stringify(await tool.execute(input)));
  expect({ [name]: violations(tool.outputSchema!, answer) }).toEqual({ [name]: [] });
  return answer as Record<string, any>;
}
const size = (value: unknown) => JSON.stringify(value).length;

describe("the tool list", () => {
  test("names, titles and descriptions keep to the draft and Chrome's budgets", () => {
    const list = shopTools(deps);
    expect(list.map((t) => t.name)).toEqual([
      "search_catalog",
      "view_cart",
      "add_to_cart",
      "update_cart_item",
      "start_checkout",
    ]);
    for (const tool of list) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,30}$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, any>;
      for (const [key, schema] of Object.entries(properties)) {
        expect(`${tool.name}.${key}`).toMatch(/^[a-z_.]+$/);
        expect(schema.description.length).toBeGreaterThan(0);
        expect(schema.description.length).toBeLessThanOrEqual(150);
      }
    }
  });

  test("every tool declares an object outputSchema in the keywords checked here", () => {
    for (const tool of shopTools(deps)) {
      expect(tool.outputSchema?.type).toBe("object");
      expect(`${tool.name} ${keywordsKnown(tool.outputSchema!)}`).toBe(`${tool.name} true`);
      expect(JSON.parse(JSON.stringify(tool.outputSchema))).toEqual(tool.outputSchema!);
    }
  });

  test("the output check is not vacuous: a wrong answer fails it", () => {
    const schema = (name: string) => shopTools(deps).find((t) => t.name === name)!.outputSchema!;
    expect(violations(schema("add_to_cart"), { added: true })).not.toEqual([]);
    expect(violations(schema("add_to_cart"), { added: false, reason: "choose_size" })).not.toEqual(
      [],
    );
    expect(violations(schema("start_checkout"), { started: false, reason: "other" })).not.toEqual(
      [],
    );
    expect(
      violations(schema("view_cart"), { lines: [], items: 0, subtotal_eur: 0, extra: 1 }),
    ).not.toEqual([]);
    expect(violations(schema("search_catalog"), { products: [{}], more: 0 })).not.toEqual([]);
  });

  test("no tool pays or reads orders; only the two reads say they are read-only", () => {
    for (const tool of shopTools(deps)) {
      expect(`${tool.name} ${tool.description}`).not.toMatch(/\b(complete|order)/i);
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/payment|instrument|card/i);
    }
    expect(
      shopTools(deps)
        .filter((t) => t.annotations?.readOnlyHint)
        .map((t) => t.name),
    ).toEqual(["search_catalog", "view_cart"]);
  });

  test("no tools on the shopper's own pages", () => {
    for (const path of ["/account", "/account/x", "/consent/ar_1", "/device", "/back-office"])
      expect(`${path} ${toolsAllowedOn(path)}`).toBe(`${path} false`);
    for (const path of ["/", "/shop", "/products/velune-trench", "/cart", "/checkout/chk_1"])
      expect(`${path} ${toolsAllowedOn(path)}`).toBe(`${path} true`);
    expect(toolsAllowedOn("/accounting")).toBe(true);
  });
});

describe("registration", () => {
  const context = (register: (name: string) => unknown, unregister?: (name: string) => void) => {
    const signals: AbortSignal[] = [];
    const ctx: ModelContext = {
      registerTool(tool, options) {
        signals.push(options!.signal!);
        return register(tool.name);
      },
      ...(unregister ? { unregisterTool: unregister } : {}),
    };
    return { ctx, signals };
  };

  test("all tools register under one signal, which unregisters them on abort", async () => {
    const { ctx, signals } = context(() => Promise.resolve(undefined));
    const controller = new AbortController();
    expect(await registerAll(ctx, shopTools(deps), controller)).toBe(true);
    expect(signals).toHaveLength(5);
    expect(new Set(signals).size).toBe(1);
    expect(signals[0]!.aborted).toBe(false);
  });

  test("one refusal, even a thrown one, aborts the signal so none stays", async () => {
    for (const fail of [
      (name: string) =>
        name === "add_to_cart" ? Promise.reject(new Error("InvalidStateError")) : undefined,
      (name: string) => {
        if (name === "view_cart") throw new TypeError("bad schema");
      },
    ]) {
      const { ctx, signals } = context(fail);
      const controller = new AbortController();
      expect(await registerAll(ctx, shopTools(deps), controller)).toBe(false);
      expect(signals[0]!.aborted).toBe(true);
    }
  });

  test("on builds that unregister by name, the abort does that for every tool", async () => {
    const gone: string[] = [];
    const { ctx } = context(
      () => undefined,
      (name) => void gone.push(name),
    );
    const controller = new AbortController();
    await registerAll(ctx, shopTools(deps), controller);
    expect(gone).toEqual([]);
    controller.abort();
    expect(gone).toHaveLength(5);
  });
});

describe("the tools", () => {
  test("search returns compact products within 1.5K, filtered like the shop", async () => {
    const all = await run("search_catalog");
    expect(all.products).toHaveLength(8);
    expect(all.more).toBe(PRODUCTS.length - 8);
    expect(size(all)).toBeLessThanOrEqual(1500);
    expect(all.products[0]).toEqual({
      product_id: "velune-trench",
      title: "Linen-blend trench coat",
      price_eur: 189,
      colours: ["Sand", "Olive"],
      sizes: ["S", "M", "L"],
    });
    const bags = await run("search_catalog", { category: "bags", limit: 20 });
    expect(bags.products.map((p: { product_id: string }) => p.product_id)).toEqual([
      "velune-market-tote",
      "velune-crossbody",
      "velune-weekender",
      "velune-laptop-backpack",
      "velune-bucket-bag",
      "velune-sling-pack",
    ]);
    // The navy weekender is sold out: only what can be bought is offered.
    expect(bags.products[2].colours).not.toContain("Navy");
    const cheap = await run("search_catalog", { max_price_eur: 30, limit: 20 });
    for (const p of cheap.products) expect(p.price_eur).toBeLessThanOrEqual(30);
  });

  test("add_to_cart asks for a colour and size, then adds the variant the shop page would", async () => {
    const vague = await run("add_to_cart", { product_id: "velune-trench" });
    expect(vague).toEqual({ added: false, reason: "choose_colour", colours: ["Sand", "Olive"] });
    const noSize = await run("add_to_cart", { product_id: "velune-trench", colour: "olive" });
    expect(noSize.reason).toBe("choose_size");
    const added = await run("add_to_cart", {
      product_id: "velune-trench",
      colour: "olive",
      size: "m",
      quantity: 2,
    });
    expect(added).toEqual({
      added: true,
      variant_id: "velune-trench-olive-m",
      in_cart: 2,
      cart_items: 2,
    });
    expect(readCart()).toEqual([{ variantId: "velune-trench-olive-m", quantity: 2 }]);
  });

  test("a single-size product needs no size, a sold-out variant is refused, ten is the most", async () => {
    const tote = await run("add_to_cart", { product_id: "velune-weekender", colour: "Navy" });
    expect(tote.added).toBe(false);
    expect(tote.reason).toBe("sold_out");
    expect(tote.in_stock.length).toBeGreaterThan(0);
    await run("add_to_cart", { product_id: "velune-crossbody", colour: "Black", quantity: 9 });
    const capped = await run("add_to_cart", {
      product_id: "velune-crossbody",
      colour: "Black",
      quantity: 9,
    });
    expect(capped.in_cart).toBe(10);
    expect((await run("add_to_cart", { product_id: "nope" })).reason).toBe("unknown_product");
  });

  test("view_cart and update_cart_item work on the same cart as the page", async () => {
    expect(await run("view_cart")).toEqual({ lines: [], items: 0, subtotal_eur: 0 });
    addToCart("velune-trench-olive-m", 1);
    addToCart("velune-rib-socks-oat-one-size", 3);
    addToCart("velune-oxford-shirt-white-s", 1);
    addToCart("velune-wool-beanie-oat-one-size", 1);
    addToCart("velune-crossbody-black-one-size", 1);
    const cart = await run("view_cart");
    expect(cart.items).toBe(7);
    expect(cart.lines[1]).toEqual({
      variant_id: "velune-rib-socks-oat-one-size",
      title: "Cotton rib socks, Oat, One size",
      quantity: 3,
      price_eur: 12,
    });
    expect(size(cart)).toBeLessThanOrEqual(1500);
    expect(await run("update_cart_item", { variant_id: "nope", quantity: 1 })).toEqual(
      expect.objectContaining({ updated: false, reason: "not_in_cart" }),
    );
    expect(
      (await run("update_cart_item", { variant_id: "velune-trench-olive-m", quantity: 11 })).reason,
    ).toBe("quantity_0_to_10");
    const removed = await run("update_cart_item", {
      variant_id: "velune-rib-socks-oat-one-size",
      quantity: 0,
    });
    expect(removed).toEqual({ updated: true, removed: true, cart_items: 4 });
    expect(readCart().map((l) => l.variantId)).not.toContain("velune-rib-socks-oat-one-size");
  });

  test("start_checkout makes the server's checkout from known lines, then opens its page", async () => {
    expect(await run("start_checkout")).toEqual({ started: false, reason: "empty_cart" });
    addToCart("velune-rib-socks-oat-one-size", 2);
    addToCart("velune-retired-item", 1);
    expect((await run("start_checkout", { email: "not an email" })).reason).toBe("invalid_email");
    const started = await run("start_checkout", { email: "ada@example.com" });
    expect(started.started).toBe(true);
    expect(started.url).toBe(`${ORIGIN}/checkout/${started.checkout_id}`);
    expect(navigated).toEqual([`/checkout/${started.checkout_id}`]);
    expect(readCart()).toEqual([]);
    const checkout = loadCheckout(started.checkout_id, "browser");
    expect(checkout.lines.map((l) => [l.variantId, l.quantity])).toEqual([
      ["velune-rib-socks-oat-one-size", 2],
    ]);
    expect(checkout.buyer?.email).toBe("ada@example.com");
  });

  test("a refused checkout keeps the cart and stays on the page", async () => {
    addToCart("velune-rib-socks-oat-one-size", 1);
    deps.createCheckout = async () => undefined;
    tools = Object.fromEntries(shopTools(deps).map((t) => [t.name, t]));
    expect(await run("start_checkout")).toEqual({ started: false, reason: "refused" });
    expect(readCart()).toHaveLength(1);
    expect(navigated).toEqual([]);
  });
});

describe("origin trial", () => {
  test("the token is sent only when it looks like one", () => {
    expect(originTrialToken({})).toBeUndefined();
    expect(originTrialToken({ WEBMCP_ORIGIN_TRIAL_TOKEN: "  " })).toBeUndefined();
    expect(originTrialToken({ WEBMCP_ORIGIN_TRIAL_TOKEN: "QWJj+/9=" })).toBe("QWJj+/9=");
    expect(originTrialToken({ WEBMCP_ORIGIN_TRIAL_TOKEN: '"QWJj"' })).toBe("QWJj");
    expect(
      originTrialToken({ WEBMCP_ORIGIN_TRIAL_TOKEN: "QWJj\r\nSet-Cookie: x" }),
    ).toBeUndefined();
    expect(originTrialToken({ WEBMCP_ORIGIN_TRIAL_TOKEN: "A".repeat(4097) })).toBeUndefined();
  });
});

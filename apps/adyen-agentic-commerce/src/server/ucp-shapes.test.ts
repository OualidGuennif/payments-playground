// UCP 2026-08-25 answer shapes the schemas alone do not catch: catalogue descriptions, search
// paging, lookup correlation, product option selection, and the order's fulfilment and quantities.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./api";
import { PRODUCTS } from "./catalog";
import { cardAlias } from "./commerce";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";

const TRENCH = "velune-trench";
const OXFORD = "velune-oxford-shirt";
const OXFORD_WHITE_S = "velune-oxford-shirt-white-s";
const OXFORD_WHITE_M = "velune-oxford-shirt-white-m";
const WEEKENDER = "velune-weekender";
const SOCKS = "velune-rib-socks";

let agent: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("Shapes agent");
});
afterAll(() => agent.stop());
beforeEach(() => {
  freshStore();
  agent.ip = randomIp();
});

async function rest(path: string, body: unknown) {
  const response = await handle(
    new Request(`${ORIGIN}/ucp/v1${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ucp-agent": 'profile="https://agent.example/profile.json"',
        "request-id": crypto.randomUUID(),
        "x-forwarded-for": randomIp(),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const search = (body: Record<string, unknown>) => rest("/catalog/search", { query: "", ...body });
const lookup = (body: Record<string, unknown>) => rest("/catalog/lookup", body);
const product = (body: Record<string, unknown>) => rest("/catalog/product", body);

describe("catalogue", () => {
  test("products and variants describe themselves as {plain}", async () => {
    const { body } = await search({ pagination: { limit: 50 } });
    expect(body.products.length).toBe(PRODUCTS.length);
    for (const p of body.products) {
      expect(p.description).toEqual({ plain: expect.any(String) });
      for (const v of p.variants) expect(v.description).toEqual({ plain: expect.any(String) });
    }
  });

  test("search pages ten by default and its cursor walks the rest once", async () => {
    const first = (await search({})).body;
    expect(first.products).toHaveLength(10);
    expect(first.pagination).toEqual({
      has_next_page: true,
      cursor: expect.any(String),
      total_count: PRODUCTS.length,
    });
    const second = (await search({ pagination: { cursor: first.pagination.cursor } })).body;
    expect(second.pagination).toEqual({ has_next_page: false, total_count: PRODUCTS.length });
    const ids = [...first.products, ...second.products].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(PRODUCTS.length);
  });

  test("search takes a smaller limit, caps a larger one at 50, refuses a bad one or a bad cursor", async () => {
    expect((await search({ pagination: { limit: 2 } })).body.products).toHaveLength(2);
    expect((await search({ pagination: { limit: 1000 } })).body.products).toHaveLength(
      PRODUCTS.length,
    );
    for (const pagination of [{ limit: 0 }, { limit: 2.5 }, { cursor: "not-a-cursor" }]) {
      const { status, body } = await search({ pagination });
      expect(status).toBe(400);
      expect(body.messages[0].code).toBe("invalid_pagination");
    }
  });

  test("lookup returns each product once with only the variants an id resolved to", async () => {
    const { status, body } = await lookup({
      ids: [TRENCH, OXFORD_WHITE_S, OXFORD, OXFORD_WHITE_S, "velune-nothing"],
    });
    expect(status).toBe(200);
    const byId = Object.fromEntries(body.products.map((p: { id: string }) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual([OXFORD, TRENCH]);
    expect(byId[TRENCH].variants).toEqual([
      expect.objectContaining({
        id: "velune-trench-sand-s",
        inputs: [{ id: TRENCH, match: "featured" }],
      }),
    ]);
    // The product id features the same variant the variant id names: one variant, two inputs.
    expect(byId[OXFORD].variants).toEqual([
      expect.objectContaining({
        id: OXFORD_WHITE_S,
        inputs: [
          { id: OXFORD_WHITE_S, match: "exact" },
          { id: OXFORD, match: "featured" },
        ],
      }),
    ]);
    expect(body.messages).toEqual([{ type: "info", code: "not_found", content: "velune-nothing" }]);
  });

  test("lookup filters after resolving: a product with no variant in range is left out", async () => {
    const { body } = await lookup({ ids: [TRENCH, SOCKS], filters: { price: { max: 5000 } } });
    expect(body.products.map((p: { id: string }) => p.id)).toEqual([SOCKS]);
  });

  test("lookup takes 50 distinct ids; more is request_too_large (REST 400, MCP -32602)", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect((await lookup({ ids: Array(60).fill(TRENCH) })).status).toBe(200);
    const refused = await lookup({ ids: many });
    expect(refused.status).toBe(400);
    expect(refused.body.messages[0].code).toBe("request_too_large");
    await agent.signIn();
    const { body } = await agent.mcp("tools/call", {
      name: "lookup_catalog",
      arguments: { catalog: { ids: many } },
    });
    expect(body.error.code).toBe(-32602);
  });

  test("product: a variant id comes first and sets selected", async () => {
    const { status, body } = await product({ id: OXFORD_WHITE_M });
    expect(status).toBe(200);
    expect(body.product.variants[0].id).toBe(OXFORD_WHITE_M);
    expect(body.product.selected).toEqual([
      { name: "colour", id: "white", label: "White" },
      { name: "size", label: "M" },
    ]);
    for (const v of body.product.variants)
      expect(v.options).toEqual(expect.arrayContaining(body.product.selected));
  });

  test("product: a product id features its first available variant; values carry availability", async () => {
    const { body } = await product({ id: WEEKENDER });
    expect(body.product.variants[0].id).toBe("velune-weekender-olive-one-size");
    expect(body.product.selected).toEqual([
      { name: "colour", id: "olive", label: "Olive" },
      { name: "size", label: "One size" },
    ]);
    const colour = body.product.options.find((o: { name: string }) => o.name === "colour");
    expect(colour.values).toEqual([
      { id: "olive", label: "Olive", available: true, exists: true },
      { id: "navy", label: "Navy", available: false, exists: true },
    ]);
  });

  test("product: selections no variant matches are dropped from the end of preferences", async () => {
    const { body } = await product({
      id: OXFORD,
      selected: [
        { name: "size", label: "M" },
        { name: "colour", label: "Purple" },
      ],
      preferences: ["size", "colour"],
    });
    expect(body.product.selected).toEqual([{ name: "size", label: "M" }]);
    expect(body.product.variants.length).toBeGreaterThan(0);
    for (const v of body.product.variants)
      expect(v.options).toContainEqual(expect.objectContaining({ name: "size", label: "M" }));
  });

  test("product: an unknown id is a 200 error body with not_found", async () => {
    const { status, body } = await product({ id: "velune-nothing" });
    expect(status).toBe(200);
    expect(body.ucp.status).toBe("error");
    expect(body.messages[0]).toEqual(
      expect.objectContaining({ type: "error", code: "not_found", severity: "unrecoverable" }),
    );
    expect(body.product).toBeUndefined();
  });
});

describe("published artifacts", () => {
  const PUBLISHED = ["/.well-known/ucp", "/ucp/v1/openapi.json", "/ucp/v1/handlers/saved_card.json"];
  const fetchGet = (path: string, headers: Record<string, string> = {}) =>
    handle(
      new Request(`${ORIGIN}${path}`, { headers: { "x-forwarded-for": randomIp(), ...headers } }),
    );

  test("are shared-cacheable for at least 60 s, with an ETag that revalidates to 304", async () => {
    for (const path of PUBLISHED) {
      const response = await fetchGet(path);
      expect(response.status).toBe(200);
      const cache = response.headers.get("cache-control") ?? "";
      expect(cache).toContain("public");
      expect(Number(/max-age=(\d+)/.exec(cache)?.[1])).toBeGreaterThanOrEqual(60);
      expect(cache).not.toMatch(/private|no-store|no-cache/);
      const etag = response.headers.get("etag");
      expect(etag).toMatch(/^"[^"]+"$/);
      const again = await fetchGet(path, { "if-none-match": etag! });
      expect(again.status).toBe(304);
      expect(await again.text()).toBe("");
    }
  });

  test("per-request answers stay no-store", async () => {
    const { headers } = await handle(
      new Request(`${ORIGIN}/ucp/v1/catalog/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "ucp-agent": 'profile="https://agent.example/profile.json"',
          "request-id": crypto.randomUUID(),
          "x-forwarded-for": randomIp(),
        },
        body: "{}",
      }),
    );
    expect(headers.get("cache-control")).toBe("no-store");
  });
});

describe("order", () => {
  test("an order carries its fulfilment and each line's quantities and status", async () => {
    await agent.signIn();
    const created = (
      await agent.tool("create_checkout", {
        meta: { "idempotency-key": crypto.randomUUID() },
        checkout: { line_items: [{ item: { id: "velune-rib-socks-oat-one-size" }, quantity: 2 }] },
      })
    ).content;
    const done = (
      await agent.tool("complete_checkout", {
        meta: { "idempotency-key": crypto.randomUUID() },
        id: created.id,
        checkout: {
          payment: {
            instruments: [
              { id: cardAlias("TEST_STORED_VISA_1111"), handler_id: "saved_card", selected: true },
            ],
          },
        },
      })
    ).content;
    const order = (await agent.tool("get_order", { id: done.order.id })).content;
    expect(order.fulfillment).toEqual({ expectations: [], events: [] });
    expect(order.line_items).toEqual([
      expect.objectContaining({
        quantity: { original: 2, total: 2, fulfilled: 0 },
        status: "processing",
      }),
    ]);
  });
});

// UCP identity linking: the profile's hard gate, 401 identity_required and 403 insufficient_scope
// with UCP bodies and Bearer challenges, UCP scope names next to the legacy ones, and UCP's
// search filters.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./api";
import { PRODUCTS, productById } from "./catalog";
import { cardAlias } from "./commerce";
import { put } from "./db";
import { ADVERTISED_SCOPES } from "./oauth";
import { freshStore, MCP, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { ucpAgent } from "./testing/platform";
import { HARD_GATES } from "./ucp";

const SOCKS = "velune-rib-socks-oat-one-size";
const ALIAS = cardAlias("TEST_STORED_VISA_1111");
const CART = "dev.ucp.shopping.cart:manage";
const CHECKOUT = "dev.ucp.shopping.checkout:manage";
const ORDERS = "dev.ucp.shopping.order:read";
const UCP_NAMES = [CART, CHECKOUT, "ucp:pay", ORDERS, "profile"];
// UCP 2026-08-25 identity_linking.json, $defs.scope_token.
const SCOPE_TOKEN =
  /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9_])?)+:[a-z][a-z0-9_]*$/;

let agent: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("Identity agent");
});
afterAll(() => agent.stop());
beforeEach(() => {
  freshStore();
  agent.accessToken = "";
  agent.ip = randomIp();
});

function rest(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return handle(
    new Request(`${ORIGIN}/ucp/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "ucp-agent": ucpAgent(),
        "request-id": crypto.randomUUID(),
        "x-forwarded-for": randomIp(),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const bearer = (token = agent.accessToken) => ({ authorization: `Bearer ${token}` });
const mutation = (headers: Record<string, string> = {}) => ({
  "idempotency-key": crypto.randomUUID(),
  ...headers,
});
const lines = (...ids: string[]) => ids.map((id) => ({ item: { id }, quantity: 1 }));
const codes = (body: { messages?: { code: string }[] }) => (body.messages ?? []).map((m) => m.code);

// A paid order placed by `agent` over MCP; the token must allow checkout and pay.
async function placeOrder() {
  const { content: created } = await agent.tool("create_checkout", {
    meta: { "idempotency-key": crypto.randomUUID() },
    checkout: { line_items: lines(SOCKS) },
  });
  const { content } = await agent.tool("complete_checkout", {
    meta: { "idempotency-key": crypto.randomUUID() },
    id: created.id,
    checkout: { payment: { instruments: [{ id: ALIAS, handler_id: "saved_card", type: "card" }] } },
  });
  expect(content.status).toBe("completed");
  return content.order.id as string;
}

describe("discovery", () => {
  test("the profile lists identity linking with only the hard gate, as a UCP scope token", async () => {
    const profile = await (await handle(new Request(`${ORIGIN}/.well-known/ucp`))).json();
    const [linking] = profile.ucp.capabilities["dev.ucp.common.identity_linking"];
    expect(linking.spec).toEndWith("/specification/common/identity-linking/");
    expect(linking.schema).toEndWith("/schemas/common/identity_linking.json");
    const scopes = Object.keys(linking.config.scopes);
    expect(scopes).toEqual([...HARD_GATES]);
    for (const scope of scopes) {
      expect(scope).toMatch(SCOPE_TOKEN);
      expect(linking.config.scopes[scope].description.plain.length).toBeGreaterThan(0);
    }
    for (const [name, [entry]] of Object.entries<{ spec: string }[]>(
      profile.ucp.capabilities,
    ).filter(([name]) => name.startsWith("dev.ucp.shopping."))) {
      expect(`${name} ${entry!.spec}`).toContain("/specification/shopping/");
    }
  });

  test("the OAuth metadata offers the UCP names, the hard gate among them, and no legacy name", async () => {
    const metadata = await (
      await handle(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))
    ).json();
    expect(metadata.scopes_supported).toEqual(ADVERTISED_SCOPES);
    expect(metadata.scopes_supported).toEqual(expect.arrayContaining([...HARD_GATES]));
    expect(metadata.scopes_supported).not.toContain("ucp:checkout");
    expect(metadata.scopes_supported).not.toContain("ucp:orders");
    for (const scope of metadata.scopes_supported.filter((s: string) => s.startsWith("dev.")))
      expect(scope).toMatch(SCOPE_TOKEN);
  });
});

describe("401 and 403", () => {
  test("an order without a token is 401 identity_required, challenged without an error", async () => {
    const response = await rest("GET", "/orders/ord_anything");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["messages", "ucp"]);
    expect(body.ucp.status).toBe("error");
    expect(codes(body)).toEqual(["identity_required"]);
    const challenge = response.headers.get("www-authenticate")!;
    expect(challenge).toStartWith(`Bearer realm="${ORIGIN}"`);
    expect(challenge).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    );
    expect(challenge).not.toContain("error=");
  });

  test("an invalid token on REST is 401 identity_required with error=invalid_token", async () => {
    const response = await rest("POST", "/catalog/search", { query: "" }, bearer("at_forged"));
    expect(response.status).toBe(401);
    expect(codes(await response.json())).toEqual(["identity_required"]);
    const challenge = response.headers.get("www-authenticate")!;
    expect(challenge).toContain(`realm="${ORIGIN}"`);
    expect(challenge).toContain('error="invalid_token"');
  });

  test("on /mcp an invalid token keeps OAuth's body and the realm", async () => {
    const response = await agent.mcp("tools/list", {}, { token: "at_forged" });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("invalid_token");
    expect(response.headers.get("www-authenticate")).toContain(`realm="${ORIGIN}"`);
    const anonymous = await handle(
      new Request(MCP, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(anonymous.status).toBe(401);
    const challenge = anonymous.headers.get("www-authenticate")!;
    expect(challenge).toContain(`realm="${ORIGIN}"`);
    expect(challenge).toContain(`/.well-known/oauth-protected-resource/mcp"`);
  });

  test("a token without the order scope is 403 naming exactly that scope", async () => {
    await agent.signIn({ ask: `${CART} ${CHECKOUT}`, scopes: [CART, CHECKOUT] });
    const response = await rest("GET", "/orders/ord_anything", undefined, bearer());
    expect(response.status).toBe(403);
    expect(codes(await response.json())).toEqual(["insufficient_scope"]);
    const challenge = response.headers.get("www-authenticate")!;
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain(`scope="${ORDERS}"`);
    expect(challenge).toContain(`realm="${ORIGIN}"`);
  });

  test("completing without the checkout scope is 403 naming the checkout scope", async () => {
    await agent.signIn({ ask: `${CART} ${ORDERS}`, scopes: [CART, ORDERS] });
    const response = await rest(
      "POST",
      "/checkout-sessions/chk_anything/complete",
      { payment: { instruments: [{ id: ALIAS, handler_id: "saved_card", type: "card" }] } },
      mutation(bearer()),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(`scope="${CHECKOUT}"`);
  });

  test("a 403 is not kept by idempotency: the same key runs once a better token is sent", async () => {
    await agent.signIn({ ask: CART, scopes: [CART] });
    const key = crypto.randomUUID();
    const body = { line_items: lines(SOCKS) };
    const refused = await rest("POST", "/checkout-sessions", body, {
      "idempotency-key": key,
      ...bearer(),
    });
    expect(refused.status).toBe(403);
    await agent.signIn({ ask: CHECKOUT, scopes: [CHECKOUT] });
    const created = await rest("POST", "/checkout-sessions", body, {
      "idempotency-key": key,
      ...bearer(),
    });
    expect(created.status).toBe(201);
  });

  test("an agent reads only orders it placed: a shopper's own order is not found", async () => {
    await agent.signIn({ ask: ORDERS, scopes: [ORDERS] });
    put("checkouts", "chk_shopper", { id: "chk_shopper" });
    put("orders", "ord_shopper", { id: "ord_shopper", checkoutId: "chk_shopper" });
    const response = await rest("GET", "/orders/ord_shopper", undefined, bearer());
    expect(response.status).toBe(404);
  });
});

describe("scope names", () => {
  test("UCP names end to end: cart, checkout, pay, then the order over REST", async () => {
    await agent.signIn({ ask: UCP_NAMES.join(" "), scopes: UCP_NAMES });
    expect(agent.scope.split(" ").sort()).toEqual([...UCP_NAMES].sort());
    const cart = await rest("POST", "/carts", { line_items: lines(SOCKS) }, mutation(bearer()));
    expect(cart.status).toBe(201);
    const orderId = await placeOrder();
    const order = await rest("GET", `/orders/${orderId}`, undefined, bearer());
    expect(order.status).toBe(200);
    const body = await order.json();
    expect(body.id).toBe(orderId);
    // profile was granted, so the buyer is shown.
    expect(body.buyer).toBeDefined();
  });

  test("a cart-only token manages carts and nothing else", async () => {
    await agent.signIn({ ask: CART, scopes: [CART] });
    const cart = await rest("POST", "/carts", { line_items: lines(SOCKS) }, mutation(bearer()));
    expect(cart.status).toBe(201);
    const checkout = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS) },
      mutation(bearer()),
    );
    expect(checkout.status).toBe(403);
  });

  test("the legacy names still work and grant exactly what they stand for", async () => {
    await agent.signIn({
      ask: "ucp:checkout ucp:pay ucp:orders",
      scopes: ["ucp:checkout", "ucp:pay", "ucp:orders"],
    });
    const cart = await rest("POST", "/carts", { line_items: lines(SOCKS) }, mutation(bearer()));
    expect(cart.status).toBe(201);
    const orderId = await placeOrder();
    const order = await rest("GET", `/orders/${orderId}`, undefined, bearer());
    expect(order.status).toBe(200);
    // profile was not granted: no buyer.
    expect((await order.json()).buyer).toBeUndefined();
  });
});

describe("signals and filters", () => {
  test("an anonymous open checkout says signing in is optional; a signed-in one does not", async () => {
    const anonymous = await (
      await rest("POST", "/checkout-sessions", { line_items: lines(SOCKS) }, mutation())
    ).json();
    const info = anonymous.messages.find((m: { code: string }) => m.code === "identity_optional");
    expect(info).toEqual(expect.objectContaining({ type: "info" }));
    await agent.signIn();
    const signedIn = await (
      await rest("POST", "/checkout-sessions", { line_items: lines(SOCKS) }, mutation(bearer()))
    ).json();
    expect(codes(signedIn)).not.toContain("identity_optional");
  });

  test("search reads UCP's categories (any of) and price range; the old category still works", async () => {
    const ids = async (filters: unknown) => {
      const body = await (await rest("POST", "/catalog/search", { query: "", filters })).json();
      return (body.products as { id: string }[]).map((p) => p.id).sort();
    };
    const of = (pick: (p: (typeof PRODUCTS)[number]) => boolean) =>
      PRODUCTS.filter(pick)
        .map((p) => p.id)
        .sort();
    expect(await ids({ categories: ["bags"] })).toEqual(of((p) => p.category === "bags"));
    expect(await ids({ categories: ["bags", "accessories"] })).toEqual(
      of((p) => p.category !== "clothing"),
    );
    expect(await ids({ category: "bags" })).toEqual(of((p) => p.category === "bags"));
    const priced = await ids({ price: { min: 5000, max: 15000 } });
    expect(priced.length).toBeGreaterThan(0);
    expect(priced).toEqual(of((p) => p.price >= 5000 && p.price <= 15000));
    for (const id of priced) expect(productById(id)!.price).toBeGreaterThanOrEqual(5000);
  });
});

// UCP over REST and MCP: the required headers, idempotency, server-side prices, and the agent
// payment state machine against the Adyen double (Authorised, Refused, Pending, network error).
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./api";
import { cardAlias, type Checkout, completeCheckout, loadCheckout } from "./commerce";
import { get } from "./db";
import { type Auth, authenticate, grants } from "./oauth";
import { fake } from "./testing/fake-adyen";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { ucpAgent } from "./testing/platform";

const SOCKS = "velune-rib-socks-oat-one-size"; // 1200 + 495 shipping
const OXFORD = "velune-oxford-shirt-white-s"; // 5900 + 495 shipping
const TRENCH = "velune-trench-sand-s"; // 18900, over the default 150 EUR limit
const BEANIE = "velune-wool-beanie-oat-one-size"; // 2900; with OXFORD 8800 + 495 shipping
const ALIAS = cardAlias("TEST_STORED_VISA_1111");

let agent: TestAgent;
let other: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("UCP agent");
  other = await TestAgent.start("Other agent");
});
afterAll(() => {
  agent.stop();
  other.stop();
});
beforeEach(() => {
  freshStore();
  agent.ip = randomIp();
  other.ip = randomIp();
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

const lines = (...ids: string[]) => ids.map((id) => ({ item: { id }, quantity: 1 }));

async function checkout(ids: string[] = [SOCKS], who = agent) {
  const { content } = await who.tool("create_checkout", {
    meta: { "idempotency-key": crypto.randomUUID() },
    checkout: { line_items: lines(...ids) },
  });
  return content;
}

const complete = (
  id: string,
  instrument: Record<string, unknown> = { id: ALIAS, handler_id: "saved_card", selected: true },
  who = agent,
) =>
  who.tool("complete_checkout", {
    meta: { "idempotency-key": crypto.randomUUID() },
    id,
    checkout: { payment: { instruments: [instrument] } },
  });

describe("REST binding", () => {
  test("UCP-Agent and Request-Id are required", async () => {
    const noAgent = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS) },
      { "ucp-agent": "" },
    );
    expect(noAgent.status).toBe(400);
    expect((await noAgent.json()).messages[0].code).toBe("invalid_profile_url");
    const noRequestId = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS) },
      { "request-id": "" },
    );
    expect(noRequestId.status).toBe(400);
    expect((await noRequestId.json()).messages[0].code).toBe("missing_header");
  });

  test("a mutation needs a UUID Idempotency-Key", async () => {
    for (const key of [undefined, "not-a-uuid"]) {
      const response = await rest(
        "POST",
        "/checkout-sessions",
        { line_items: lines(SOCKS) },
        key ? { "idempotency-key": key } : {},
      );
      expect(response.status).toBe(400);
      expect((await response.json()).messages[0].code).toBe("missing_idempotency_key");
    }
  });

  test("a replay returns the first answer; the same key with another body is 409", async () => {
    const key = crypto.randomUUID();
    const first = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS) },
      { "idempotency-key": key },
    );
    expect(first.status).toBe(201);
    const replay = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS) },
      { "idempotency-key": key },
    );
    expect(replay.status).toBe(201);
    expect((await replay.json()).id).toBe((await first.json()).id);
    const reused = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(OXFORD) },
      { "idempotency-key": key },
    );
    expect(reused.status).toBe(409);
    expect((await reused.json()).messages[0].code).toBe("idempotency_key_reused");
  });

  test("reads need no Idempotency-Key and catalogue POSTs are reads", async () => {
    const response = await rest("POST", "/catalog/search", { query: "socks" });
    expect(response.status).toBe(200);
    expect((await response.json()).products[0].id).toBe("velune-rib-socks");
  });

  test("an unknown route is 404", async () => {
    expect((await rest("GET", "/payments")).status).toBe(404);
  });

  test("the server prices the checkout: one subtotal, one total, client prices ignored", async () => {
    const response = await rest(
      "POST",
      "/checkout-sessions",
      {
        line_items: [{ item: { id: SOCKS, price: 1 }, quantity: 1 }],
        totals: [{ type: "total", amount: 1 }],
      },
      { "idempotency-key": crypto.randomUUID() },
    );
    const body = await response.json();
    expect(body.totals.filter((t: { type: string }) => t.type === "subtotal")).toEqual([
      expect.objectContaining({ amount: 1200 }),
    ]);
    expect(body.totals.filter((t: { type: string }) => t.type === "total")).toEqual([
      expect.objectContaining({ amount: 1695 }),
    ]);
    expect(body.currency).toBe("EUR");
  });

  // ADR-015: a guest agent may pay with its own network token, so its checkout is ready.
  test("an anonymous agent with a buyer email is ready to pay with its own token", async () => {
    const response = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS), buyer: { email: "buyer@example.com" } },
      { "idempotency-key": crypto.randomUUID() },
    );
    const body = await response.json();
    expect(body.status).toBe("ready_for_complete");
    expect(body.payment).toBeUndefined();
    expect(body.messages.map((m: { code: string }) => m.code)).toContain("identity_optional");
    expect(body.continue_url).toBe(`${ORIGIN}/checkout/${body.id}`);
    expect(body.payment).toBeUndefined();
  });

  test("a scope the token lacks is 403 insufficient_scope with WWW-Authenticate", async () => {
    await agent.signIn({ scopes: ["ucp:orders"] });
    const response = await rest(
      "POST",
      "/checkout-sessions",
      { line_items: lines(SOCKS) },
      {
        "idempotency-key": crypto.randomUUID(),
        authorization: `Bearer ${agent.accessToken}`,
      },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });
});

describe("cart to checkout", () => {
  const key = () => ({ "idempotency-key": crypto.randomUUID() });

  test("a cart_id checkout takes the cart's lines and buyer over overlapping fields", async () => {
    await agent.signIn();
    const cart = (
      await agent.tool("create_cart", {
        meta: key(),
        cart: { line_items: lines(OXFORD), buyer: { email: "cart@example.com" } },
      })
    ).content;
    const fromId = (
      await agent.tool("create_checkout", { meta: key(), checkout: { cart_id: cart.id } })
    ).content;
    expect(fromId.line_items.map((l: { item: { id: string } }) => l.item.id)).toEqual([OXFORD]);
    // UCP 2026-08-25 cart extension: the business uses the cart's contents and ignores the
    // checkout payload's overlapping fields, even an invalid one.
    const both = (
      await agent.tool("create_checkout", {
        meta: key(),
        checkout: {
          cart_id: cart.id,
          line_items: lines(SOCKS, BEANIE),
          buyer: { email: "not an email" },
        },
      })
    ).content;
    expect(both.line_items.map((l: { item: { id: string } }) => l.item.id)).toEqual([OXFORD]);
    expect(
      loadCheckout(both.id, authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth).buyer,
    ).toEqual({ email: "cart@example.com" });
  });

  test("without a buyer on the cart, the checkout's own buyer is used", async () => {
    await agent.signIn();
    const cart = (
      await agent.tool("create_cart", { meta: key(), cart: { line_items: lines(SOCKS) } })
    ).content;
    const created = (
      await agent.tool("create_checkout", {
        meta: key(),
        checkout: { cart_id: cart.id, buyer: { email: "ada@example.com" } },
      })
    ).content;
    expect(
      loadCheckout(created.id, authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth).buyer,
    ).toEqual({ email: "ada@example.com" });
  });
});

describe("agent payment", () => {
  test("a signed-in agent within its limit pays once with the saved card, ContAuth", async () => {
    await agent.signIn();
    const created = await checkout();
    expect(created.status).toBe("ready_for_complete");
    expect(created.payment.instruments).toEqual([
      expect.objectContaining({ id: ALIAS, handler_id: "saved_card", selected: true }),
    ]);
    expect(JSON.stringify(created)).not.toContain("TEST_STORED_VISA_1111");

    const { content } = await complete(created.id);
    expect(content.status).toBe("completed");
    expect(content.order.permalink_url).toBe(`${ORIGIN}/orders/${content.order.id}`);
    expect(fake.payments).toEqual([
      expect.objectContaining({
        amount: 1695,
        reference: `${created.id}-a1`,
        idempotencyKey: `agent-pay-${created.id}-a1`,
        storedPaymentMethodId: "TEST_STORED_VISA_1111",
      }),
    ]);
    expect(grants()[0]!.spent).toBe(1695);

    expect((await complete(created.id)).content.status).toBe("completed");
    expect(fake.payments).toHaveLength(1);
  });

  test("two completes at once pay once", async () => {
    await agent.signIn();
    const created = await checkout();
    // Both calls hold the same loaded checkout, as two requests that passed the edge together do.
    const auth = authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth;
    const loaded = loadCheckout(created.id, auth);
    const body = { payment: { instruments: [{ id: ALIAS, handler_id: "saved_card" }] } };
    await Promise.all([completeCheckout(loaded, body, auth), completeCheckout(loaded, body, auth)]);
    expect(fake.payments).toHaveLength(1);
    expect(grants()[0]!.spent).toBe(1695);
  });

  test("completes on two checkouts at once stay within the budget", async () => {
    await agent.signIn();
    // 9295 each: either fits the 15000 budget alone, both together do not.
    const first = await checkout([OXFORD, BEANIE]);
    const second = await checkout([OXFORD, BEANIE]);
    const auth = authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth;
    const body = { payment: { instruments: [{ id: ALIAS, handler_id: "saved_card" }] } };
    await Promise.all([
      completeCheckout(loadCheckout(first.id, auth), body, auth),
      completeCheckout(loadCheckout(second.id, auth), body, auth),
    ]);
    expect(fake.payments).toHaveLength(1);
    expect(grants()[0]!.spent).toBe(9295);
  });

  test("a refusal ends the attempt, not the checkout; the retry uses a new key", async () => {
    await agent.signIn();
    const created = await checkout();
    fake.answers.push({ resultCode: "Refused", refusalReason: "Not enough balance" });
    const refused = (await complete(created.id)).content;
    expect(refused.status).toBe("ready_for_complete");
    expect(refused.messages.map((m: { code: string }) => m.code)).toContain("payment_refused");
    expect(grants()[0]!.spent).toBe(0);

    expect((await complete(created.id)).content.status).toBe("completed");
    expect(fake.payments.map((p) => p.idempotencyKey)).toEqual([
      `agent-pay-${created.id}-a1`,
      `agent-pay-${created.id}-a2`,
    ]);
  });

  test("a network error keeps the attempt, so the retry reuses the same key", async () => {
    await agent.signIn();
    const created = await checkout();
    fake.answers.push(new Error("socket hang up"));
    const failed = (await complete(created.id)).content;
    expect(failed.messages.map((m: { code: string }) => m.code)).toContain("payment_unavailable");
    await complete(created.id);
    expect(fake.payments.map((p) => p.idempotencyKey)).toEqual([
      `agent-pay-${created.id}-a1`,
      `agent-pay-${created.id}-a1`,
    ]);
  });

  test("Pending holds the checkout in progress and reserves the budget", async () => {
    await agent.signIn();
    const created = await checkout();
    fake.answers.push({ resultCode: "Pending" });
    expect((await complete(created.id)).content.status).toBe("complete_in_progress");
    expect(grants()[0]!.spent).toBe(1695);
    expect((await complete(created.id)).content.status).toBe("complete_in_progress");
    expect(fake.payments).toHaveLength(1);
  });

  test("a total over the remaining budget is escalated and never sent to Adyen", async () => {
    await agent.signIn();
    const created = await checkout([TRENCH]);
    expect(created.status).toBe("requires_escalation");
    expect(created.messages.map((m: { code: string }) => m.code)).toContain("spend_limit_exceeded");
    expect((await complete(created.id)).content.status).toBe("requires_escalation");
    expect(fake.payments).toHaveLength(0);
  });

  test("without ucp:pay the agent sees no saved card and cannot pay with one", async () => {
    await agent.signIn({ scopes: ["ucp:checkout", "ucp:orders"] });
    const created = await checkout();
    // Ready for a network token of its own; the account's cards stay out of reach.
    expect(created.status).toBe("ready_for_complete");
    expect(created.payment).toBeUndefined();
    const paid = await complete(created.id);
    expect(paid.isError).toBe(true);
    expect(paid.content.messages[0].code).toBe("unknown_instrument");
    expect(fake.payments).toHaveLength(0);
  });

  test("without a card saved for unscheduled use the shopper must pay", async () => {
    fake.cards = [{ ...fake.cards[0]!, models: ["CardOnFile"] }];
    await agent.signIn();
    const created = await checkout();
    expect(created.messages.map((m: { code: string }) => m.code)).toContain("no_saved_card");
  });

  test("an unknown instrument or another handler is refused", async () => {
    await agent.signIn();
    const created = await checkout();
    const unknown = await complete(created.id, { id: "card_unknown", handler_id: "saved_card" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content.messages[0].code).toBe("unknown_instrument");
    const handler = await complete(created.id, { id: ALIAS, handler_id: "com.google.pay" });
    expect(handler.content.messages[0].code).toBe("unsupported_handler");
    expect(fake.payments).toHaveLength(0);
  });

  test("a completed checkout cannot be edited or canceled", async () => {
    await agent.signIn();
    const created = await checkout();
    await complete(created.id);
    const update = await agent.tool("update_checkout", {
      meta: { "idempotency-key": crypto.randomUUID() },
      id: created.id,
      checkout: { line_items: lines(OXFORD) },
    });
    expect(update.content.messages[0].code).toBe("checkout_not_editable");
    const cancel = await agent.tool("cancel_checkout", {
      meta: { "idempotency-key": crypto.randomUUID() },
      id: created.id,
    });
    expect(cancel.content.messages[0].code).toBe("checkout_not_cancelable");
    expect(get<Checkout>("checkouts", created.id)!.phase).toBe("completed");
  });

  test("another agent cannot see or pay this agent's checkout or order", async () => {
    await agent.signIn();
    await other.signIn();
    const created = await checkout();
    const done = (await complete(created.id)).content;
    expect((await other.tool("get_checkout", { id: created.id })).content.messages[0].code).toBe(
      "not_found",
    );
    expect((await other.tool("get_order", { id: done.order.id })).content.messages[0].code).toBe(
      "not_found",
    );
    expect(
      (await agent.tool("get_order", { id: done.order.id })).content.payment.psp_reference,
    ).toBe("PSP1");
  });

  test("MCP honours an idempotency key when one is sent", async () => {
    await agent.signIn();
    const key = crypto.randomUUID();
    const a = await agent.tool("create_checkout", {
      meta: { "idempotency-key": key },
      checkout: { line_items: lines(SOCKS) },
    });
    const b = await agent.tool("create_checkout", {
      meta: { "idempotency-key": key },
      checkout: { line_items: lines(SOCKS) },
    });
    expect(b.content.id).toBe(a.content.id);
    const c = await agent.tool("create_checkout", {
      meta: { "idempotency-key": key },
      checkout: { line_items: lines(OXFORD) },
    });
    expect(c.content.messages[0].code).toBe("idempotency_key_reused");
  });
});

// An agent brings its own card as a network token's number and expiry (ADR-015): the brand read
// from Adyen, the exact /payments request, a credential used once and kept nowhere, guests and
// signed-in agents, limits, refusals, and the hand-over to the shopper with no instrument.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { networkTokenRequest } from "./adyen";
import { handle } from "./api";
import type { Order, PaymentRecord } from "./commerce";
import { database, get, list } from "./db";
import { grants } from "./oauth";
import { fake } from "./testing/fake-adyen";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { ucpAgent } from "./testing/platform";

const SOCKS = "velune-rib-socks-oat-one-size"; // 1200 + 495 shipping
// Visa's TEST number, the owner's choice for a network token on TEST (2026-11-17).
const NUMBER = "4111111111111111";
const nextYear = new Date().getUTCFullYear() + 1;
const credential = (change: Record<string, unknown> = {}) => ({
  type: "network_token",
  number: NUMBER,
  expiry_month: 8,
  expiry_year: nextYear,
  name: "Ada Lovelace",
  ...change,
});
const instrument = (change: Record<string, unknown> = {}) => ({
  id: "nt_1",
  handler_id: "network_token",
  type: "card",
  selected: true,
  credential: credential(change),
});
const sentToken = {
  number: NUMBER,
  expiryMonth: "08",
  expiryYear: String(nextYear),
  holderName: "Ada Lovelace",
  brand: "visa",
};

function rest(method: string, path: string, body?: unknown) {
  return handle(
    new Request(`${ORIGIN}/ucp/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "ucp-agent": ucpAgent(),
        "request-id": crypto.randomUUID(),
        "idempotency-key": crypto.randomUUID(),
        "x-forwarded-for": randomIp(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function guestCheckout() {
  const response = await rest("POST", "/checkout-sessions", {
    line_items: [{ item: { id: SOCKS }, quantity: 1 }],
    buyer: { email: "ada@example.com" },
  });
  return (await response.json()) as Record<string, any>;
}

async function guestComplete(id: string, body: unknown) {
  const response = await rest("POST", `/checkout-sessions/${id}/complete`, body);
  return { status: response.status, text: await response.text() };
}

// Everything the store wrote: documents, protocol trace and idempotency answers.
const everythingStored = () =>
  JSON.stringify(
    database()
      .query("select name from sqlite_master where type = 'table'")
      .all()
      .map((t) =>
        database()
          .query(`select * from "${(t as { name: string }).name}"`)
          .all(),
      ),
  );

beforeEach(() => freshStore());

const statusOf = async (id: string) =>
  ((await (await rest("GET", `/checkout-sessions/${id}`)).json()) as { status: string }).status;

describe("the Adyen request", () => {
  test("is a networkToken payment with the brand Adyen read, ContAuth, unscheduled card on file", () => {
    const request = networkTokenRequest(
      {
        amount: 1695,
        reference: "chk_1-a1",
        token: sentToken,
        idempotencyKey: "agent-pay-chk_1-a1",
        shopperEmail: "ada@example.com",
        metadata: { checkoutId: "chk_1", channel: "agent", agent: "Guest agent" },
      },
      "FakeMerchantECOM",
    );
    expect(JSON.parse(JSON.stringify(request))).toEqual({
      merchantAccount: "FakeMerchantECOM",
      amount: { currency: "EUR", value: 1695 },
      reference: "chk_1-a1",
      returnUrl: `${ORIGIN}/agents`,
      paymentMethod: {
        type: "networkToken",
        brand: "visa",
        number: NUMBER,
        expiryMonth: "08",
        expiryYear: String(nextYear),
        holderName: "Ada Lovelace",
      },
      shopperInteraction: "ContAuth",
      recurringProcessingModel: "UnscheduledCardOnFile",
      shopperEmail: "ada@example.com",
      metadata: { checkoutId: "chk_1", channel: "agent", agent: "Guest agent" },
    });
  });
});

describe("a guest agent", () => {
  test("pays once with its token's number and expiry; the brand comes from Adyen", async () => {
    const created = await guestCheckout();
    expect(created.status).toBe("ready_for_complete");
    const paid = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(paid.status).toBe(200);
    const body = JSON.parse(paid.text);
    expect(body.status).toBe("completed");
    expect(fake.brandLookups).toEqual([NUMBER]);
    expect(fake.payments).toEqual([
      {
        amount: 1695,
        reference: `${created.id}-a1`,
        token: sentToken,
        idempotencyKey: `agent-pay-${created.id}-a1`,
        shopperEmail: "ada@example.com",
        metadata: { checkoutId: created.id, channel: "agent", agent: "Guest agent" },
      },
    ]);
    const order = get<Order>("orders", body.order.id)!;
    expect([order.channel, order.paidBy, order.customerId]).toEqual(["agent", "agent", undefined]);
    const [record] = list<PaymentRecord>("payments");
    expect([record!.instrument, record!.lastFour, record!.reservation]).toEqual([
      "network_token",
      "1111",
      undefined,
    ]);
  });

  test("a cryptogram, a CVC or a brand from the agent is ignored, never sent", async () => {
    fake.brand = "mc";
    const created = await guestCheckout();
    const paid = await guestComplete(created.id, {
      payment: {
        instruments: [
          instrument({ cryptogram: "AgAAAAAABk4DWZ4C28yUQAAAAAA=", cvc: "737", brand: "amex" }),
        ],
      },
    });
    expect(JSON.parse(paid.text).status).toBe("completed");
    expect(fake.payments[0]).toMatchObject({ token: { ...sentToken, brand: "mc" } });
    expect(Object.keys((fake.payments[0] as { token: object }).token).sort()).toEqual(
      Object.keys(sentToken).sort(),
    );
  });

  test("leaves no credential in the database, the trace or any answer", async () => {
    const created = await guestCheckout();
    const paid = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    const refused = await guestComplete((await guestCheckout()).id, {
      payment: { instruments: [instrument({ expiry_month: 13 })] },
    });
    fake.brand = new Error(`lookup failed for ${NUMBER}`);
    const failed = await guestComplete((await guestCheckout()).id, {
      payment: { instruments: [instrument()] },
    });
    for (const secret of [NUMBER, NUMBER.slice(0, 12)]) {
      expect(everythingStored()).not.toContain(secret);
      for (const answer of [paid, refused, failed]) expect(answer.text).not.toContain(secret);
    }
  });

  test("a bad field is invalid_credential at its path; Adyen is not asked and the checkout is kept", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ number: "4111" }, "number"],
      [{ number: 4111111111111111 }, "number"],
      [{ expiry_month: 13 }, "expiry_month"],
      [{ expiry_month: undefined }, "expiry_month"],
      [{ expiry_year: 2020 }, "expiry_year"],
      [{ expiry_year: "2099" }, "expiry_year"],
    ];
    const created = await guestCheckout();
    for (const [change, field] of cases) {
      const answer = await guestComplete(created.id, {
        payment: { instruments: [instrument(change)] },
      });
      expect(answer.status).toBe(400);
      const message = JSON.parse(answer.text).messages[0];
      expect([message.code, message.path]).toEqual([
        "invalid_credential",
        `$.payment.instruments[0].credential.${field}`,
      ]);
    }
    const wrongType = await guestComplete(created.id, {
      payment: { instruments: [instrument({ type: "card" })] },
    });
    expect(JSON.parse(wrongType.text).messages[0].code).toBe("invalid_credential");
    expect(fake.brandLookups).toHaveLength(0);
    expect(fake.payments).toHaveLength(0);
    expect(await statusOf(created.id)).toBe("ready_for_complete");
  });

  test("a number Adyen gives no brand is invalid_credential; a failed lookup is 502 and pays nothing", async () => {
    const created = await guestCheckout();
    fake.brand = undefined;
    const unknown = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(unknown.status).toBe(400);
    const message = JSON.parse(unknown.text).messages[0];
    expect([message.code, message.path]).toEqual([
      "invalid_credential",
      "$.payment.instruments[0].credential.number",
    ]);
    fake.brand = new Error("connect ECONNREFUSED");
    const failed = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.text).messages[0].code).toBe("payment_unavailable");
    expect(fake.payments).toHaveLength(0);
    expect(await statusOf(created.id)).toBe("ready_for_complete");
    fake.brand = "visa";
    const paid = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(JSON.parse(paid.text).status).toBe("completed");
    expect(fake.payments.map((p) => p.reference)).toEqual([`${created.id}-a1`]);
  });

  test("cannot pay with a saved card", async () => {
    const created = await guestCheckout();
    const saved = await guestComplete(created.id, {
      payment: { instruments: [{ id: "card_0123456789abcdef0123", handler_id: "saved_card" }] },
    });
    expect(JSON.parse(saved.text).messages[0].code).toBe("unknown_instrument");
    expect(fake.payments).toHaveLength(0);
  });

  test("with no instrument hands the checkout to the shopper, who pays at continue_url", async () => {
    const created = await guestCheckout();
    const handed = await guestComplete(created.id, { payment: { instruments: [] } });
    expect(handed.status).toBe(200);
    const body = JSON.parse(handed.text);
    expect(body.status).toBe("requires_escalation");
    expect(body.continue_url).toBe(`${ORIGIN}/checkout/${created.id}`);
    expect(body.messages.map((m: { code: string }) => m.code)).toContain("shopper_pays");
    expect(await statusOf(created.id)).toBe("requires_escalation");
    // The agent cannot take it back with a token; the shopper's Drop-in still opens.
    const later = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(JSON.parse(later.text).status).toBe("requires_escalation");
    expect(fake.brandLookups).toHaveLength(0);
    expect(fake.payments).toHaveLength(0);
    const session = await handle(
      new Request(`${ORIGIN}/api/checkouts/${created.id}/session`, {
        method: "POST",
        headers: { "x-forwarded-for": randomIp() },
      }),
    );
    expect(session.status).toBe(200);
  });

  test("a refusal reopens the checkout and offers another token or the shopper; the retry is a new attempt", async () => {
    fake.answers = [
      { resultCode: "Refused", pspReference: "PSPREFUSED", refusalReason: "Refused" },
    ];
    const created = await guestCheckout();
    const refused = JSON.parse(
      (await guestComplete(created.id, { payment: { instruments: [instrument()] } })).text,
    );
    expect(refused.status).toBe("ready_for_complete");
    const message = refused.messages.find((m: { code: string }) => m.code === "payment_refused");
    expect(message.content).toContain("another network token");
    expect(message.content).toContain("continue_url");
    const retried = JSON.parse(
      (await guestComplete(created.id, { payment: { instruments: [instrument()] } })).text,
    );
    expect(retried.status).toBe("completed");
    expect(fake.payments.map((p) => p.idempotencyKey)).toEqual([
      `agent-pay-${created.id}-a1`,
      `agent-pay-${created.id}-a2`,
    ]);
  });
});

describe("a signed-in agent", () => {
  let agent: TestAgent;
  beforeAll(async () => {
    agent = await TestAgent.start("Token agent");
  });
  afterAll(() => agent.stop());
  beforeEach(() => {
    agent.ip = randomIp();
  });

  const checkout = async () =>
    (
      await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      })
    ).content;
  const complete = (id: string, instruments: unknown[] = [instrument()]) =>
    agent.tool("complete_checkout", {
      meta: { "idempotency-key": crypto.randomUUID() },
      id,
      checkout: { payment: { instruments } },
    });

  test("pays with its token within its limit, and the total is charged to its grant", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const created = await checkout();
    const paid = await complete(created.id);
    expect(paid.content.status).toBe("completed");
    expect(grants()[0]!.spent).toBe(1695);
    const [record] = list<PaymentRecord>("payments");
    expect([record!.instrument, record!.reservation, record!.customerId]).toEqual([
      "network_token",
      "held",
      undefined,
    ]);
    const order = get<Order>("orders", paid.content.order.id)!;
    expect(order.customerId).toBeTruthy();
    expect(order.channel).toBe("agent");
    expect(fake.payments[0]).not.toHaveProperty("shopperReference");
  });

  test("over its remaining limit the number is sent nowhere; the shopper approves", async () => {
    await agent.signIn({ spendLimitEur: 10 });
    const created = await checkout();
    expect(created.status).toBe("requires_escalation");
    const paid = await complete(created.id);
    expect(paid.content.status).toBe("requires_escalation");
    expect(fake.brandLookups).toHaveLength(0);
    expect(fake.payments).toHaveLength(0);
    expect(grants()[0]!.spent).toBe(0);
  });

  test("a refusal gives the reservation back", async () => {
    fake.answers = [
      { resultCode: "Refused", pspReference: "PSPREFUSED", refusalReason: "Refused" },
    ];
    await agent.signIn({ spendLimitEur: 150 });
    const created = await checkout();
    const refused = await complete(created.id);
    expect(refused.content.status).toBe("ready_for_complete");
    expect(grants()[0]!.spent).toBe(0);
  });

  test("with no instrument also hands the checkout to the shopper, and reserves nothing", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const created = await checkout();
    const handed = await complete(created.id, []);
    expect(handed.content.status).toBe("requires_escalation");
    expect(handed.content.continue_url).toBe(`${ORIGIN}/checkout/${created.id}`);
    expect(fake.payments).toHaveLength(0);
    expect(grants()[0]!.spent).toBe(0);
  });
});

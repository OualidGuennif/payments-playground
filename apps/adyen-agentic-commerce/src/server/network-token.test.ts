// An agent brings its own card as a one-time network token (ADR-015): the exact Adyen request, a
// credential that is used once and kept nowhere, guests and signed-in agents, limits, refusals.
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
const NUMBER = "4895370015293175";
const CRYPTOGRAM = "AgAAAAAABk4DWZ4C28yUQAAAAAA=";
const nextYear = new Date().getUTCFullYear() + 1;
const credential = (change: Record<string, unknown> = {}) => ({
  type: "network_token",
  number: NUMBER,
  expiry_month: 12,
  expiry_year: nextYear,
  cryptogram: CRYPTOGRAM,
  eci_value: "05",
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

describe("the Adyen request", () => {
  test("is a networkToken payment with the cryptogram in mpiData, Ecommerce, nothing stored", () => {
    const request = networkTokenRequest(
      {
        amount: 1695,
        reference: "chk_1-a1",
        token: {
          number: NUMBER,
          expiryMonth: "12",
          expiryYear: String(nextYear),
          holderName: "Ada Lovelace",
          cryptogram: CRYPTOGRAM,
          eci: "05",
        },
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
        number: NUMBER,
        expiryMonth: "12",
        expiryYear: String(nextYear),
        holderName: "Ada Lovelace",
      },
      mpiData: {
        directoryResponse: "Y",
        authenticationResponse: "Y",
        tokenAuthenticationVerificationValue: CRYPTOGRAM,
        eci: "05",
      },
      shopperInteraction: "Ecommerce",
      shopperEmail: "ada@example.com",
      metadata: { checkoutId: "chk_1", channel: "agent", agent: "Guest agent" },
    });
  });
});

describe("a guest agent", () => {
  test("pays once with its token; the order is the agent channel's, with no account", async () => {
    const created = await guestCheckout();
    expect(created.status).toBe("ready_for_complete");
    const paid = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(paid.status).toBe(200);
    const body = JSON.parse(paid.text);
    expect(body.status).toBe("completed");
    expect(fake.payments).toEqual([
      {
        amount: 1695,
        reference: `${created.id}-a1`,
        token: {
          number: NUMBER,
          expiryMonth: "12",
          expiryYear: String(nextYear),
          holderName: "Ada Lovelace",
          cryptogram: CRYPTOGRAM,
          eci: "05",
        },
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
      "3175",
      undefined,
    ]);
  });

  test("leaves no credential in the database, the trace or any answer", async () => {
    const created = await guestCheckout();
    const paid = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    const refused = await guestComplete((await guestCheckout()).id, {
      payment: { instruments: [instrument({ eci_value: "5" })] },
    });
    for (const secret of [NUMBER, CRYPTOGRAM, NUMBER.slice(0, 12)]) {
      expect(everythingStored()).not.toContain(secret);
      expect(paid.text).not.toContain(secret);
      expect(refused.text).not.toContain(secret);
    }
  });

  test("a bad field is invalid_credential at its path, and the checkout is left as it was", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ number: "4111" }, "number"],
      [{ expiry_month: 13 }, "expiry_month"],
      [{ expiry_year: 2020 }, "expiry_year"],
      [{ expiry_year: "2099" }, "expiry_year"],
      [{ cryptogram: undefined }, "cryptogram"],
      [{ eci_value: "5" }, "eci_value"],
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
    expect(fake.payments).toHaveLength(0);
    const after = (await (await rest("GET", `/checkout-sessions/${created.id}`)).json()) as {
      status: string;
    };
    expect(after.status).toBe("ready_for_complete");
  });

  test("cannot pay with a saved card, and an instrument is required", async () => {
    const created = await guestCheckout();
    const saved = await guestComplete(created.id, {
      payment: { instruments: [{ id: "card_0123456789abcdef0123", handler_id: "saved_card" }] },
    });
    expect(JSON.parse(saved.text).messages[0].code).toBe("unknown_instrument");
    const none = await guestComplete(created.id, { payment: { instruments: [] } });
    expect(JSON.parse(none.text).messages[0].code).toBe("instrument_required");
    expect(fake.payments).toHaveLength(0);
  });

  test("a refusal reopens the checkout and asks for a new cryptogram; the retry is a new attempt", async () => {
    fake.answers = [
      { resultCode: "Refused", pspReference: "PSPREFUSED", refusalReason: "Refused" },
    ];
    const created = await guestCheckout();
    const refused = JSON.parse(
      (await guestComplete(created.id, { payment: { instruments: [instrument()] } })).text,
    );
    expect(refused.status).toBe("ready_for_complete");
    const message = refused.messages.find((m: { code: string }) => m.code === "payment_refused");
    expect(message.content).toContain("cryptogram");
    const retried = JSON.parse(
      (
        await guestComplete(created.id, {
          payment: { instruments: [instrument({ cryptogram: "AgAAAAAABk4DWZ4C28yUQBBBBBB=" })] },
        })
      ).text,
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
  const complete = (id: string, change: Record<string, unknown> = {}) =>
    agent.tool("complete_checkout", {
      meta: { "idempotency-key": crypto.randomUUID() },
      id,
      checkout: { payment: { instruments: [instrument(change)] } },
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

  test("over its remaining limit the token is never sent; the shopper approves", async () => {
    await agent.signIn({ spendLimitEur: 10 });
    const created = await checkout();
    expect(created.status).toBe("requires_escalation");
    const paid = await complete(created.id);
    expect(paid.content.status).toBe("requires_escalation");
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
});

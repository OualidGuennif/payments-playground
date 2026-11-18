// An agent brings its own card as a network token's number and expiry (ADR-015): the brand read
// from Adyen, the exact /payments request, a credential used once and kept nowhere, guests and
// signed-in agents, limits, refusals, and the hand-over to the shopper with no instrument.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { networkTokenRequest } from "./adyen";
import { handle } from "./api";
import type { Order, PaymentRecord } from "./commerce";
import { database, get, list, put } from "./db";
import { authenticate, grants } from "./oauth";
import { recentTrace } from "./trace";
import { fake } from "./testing/fake-adyen";
import { freshStore, ORIGIN, randomIp, signUpCustomer, TestAgent } from "./testing/agent";
import { customerFromCookies } from "./customers";
import { SoftAuthenticator } from "./testing/authenticator";
import { ucpAgent } from "./testing/platform";
import { OPERATIONS } from "./ucp";
import { canonicalJson, sha256 } from "./util";

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

  test("cannot pay with a saved card; an instrument naming nothing is refused, not a hand-over", async () => {
    const created = await guestCheckout();
    for (const sent of [
      { id: "card_0123456789abcdef0123", handler_id: "saved_card" },
      { handler_id: "saved_card", type: "card" },
      "card",
    ]) {
      const answer = await guestComplete(created.id, { payment: { instruments: [sent] } });
      expect([answer.status, JSON.parse(answer.text).messages[0].code]).toEqual([
        400,
        "unknown_instrument",
      ]);
    }
    expect(fake.payments).toHaveLength(0);
    expect(await statusOf(created.id)).toBe("ready_for_complete");
  });

  test("the stored idempotency hash is not a hash of the credential's body", async () => {
    const created = await guestCheckout();
    const body = { payment: { instruments: [instrument()] } };
    const key = crypto.randomUUID();
    const send = (sent: unknown) =>
      handle(
        new Request(`${ORIGIN}/ucp/v1/checkout-sessions/${created.id}/complete`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "ucp-agent": ucpAgent(),
            "request-id": crypto.randomUUID(),
            "idempotency-key": key,
            "x-forwarded-for": randomIp(),
          },
          body: JSON.stringify(sent),
        }),
      );
    expect((await send(body)).status).toBe(200);
    const hashes = database()
      .query("select request_hash from idempotency")
      .all()
      .map((r) => (r as { request_hash: string }).request_hash);
    expect(hashes).not.toContain(sha256(canonicalJson(body)));
    // The same body under the same key replays the one payment; another token is another body.
    const replay = await send(body);
    expect(JSON.parse(await replay.text()).status).toBe("completed");
    const other = await send({
      payment: { instruments: [instrument({ number: "5555555555554444" })] },
    });
    expect(other.status).toBe(409);
    expect(JSON.parse(await other.text()).messages[0].code).toBe("idempotency_key_reused");
    expect(fake.payments).toHaveLength(1);
  });

  test("a token refused as invalid is corrected under a new Idempotency-Key, not the old one", async () => {
    const created = await guestCheckout();
    const key = crypto.randomUUID();
    const send = (change: Record<string, unknown>) =>
      handle(
        new Request(`${ORIGIN}/ucp/v1/checkout-sessions/${created.id}/complete`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "ucp-agent": ucpAgent(),
            "request-id": crypto.randomUUID(),
            "idempotency-key": key,
            "x-forwarded-for": randomIp(),
          },
          body: JSON.stringify({ payment: { instruments: [instrument(change)] } }),
        }),
      );
    expect((await send({ expiry_year: 2020 })).status).toBe(400);
    const corrected = await send({});
    expect(corrected.status).toBe(409);
    expect(JSON.parse(await corrected.text()).messages[0].code).toBe("idempotency_key_reused");
    const fresh = await guestComplete(created.id, { payment: { instruments: [instrument()] } });
    expect(JSON.parse(fresh.text).status).toBe("completed");
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

// ChatGPT, 2026-11-18: an agent with EUR 1 left was sent to the shopper for a EUR 63.95 shirt, and
// nothing told either of them where the limit is changed. The shopper changes it on the account
// page, on the same grant, without the agent signing in again.
describe("agent budget", () => {
  const SHIRT = "velune-oxford-shirt-white-l"; // 5900 + 495 shipping
  let agent: TestAgent;
  beforeAll(async () => {
    agent = await TestAgent.start("Budget agent");
  });
  afterAll(() => agent.stop());
  beforeEach(() => {
    agent.ip = randomIp();
  });

  const shirt = async () =>
    (
      await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SHIRT }, quantity: 1 }] },
      })
    ).content;
  const pay = (id: string) =>
    agent.tool("complete_checkout", {
      meta: { "idempotency-key": crypto.randomUUID() },
      id,
      checkout: { payment: { instruments: [instrument()] } },
    });
  const read = async (id: string) => (await agent.tool("get_checkout", { id })).content;
  const setLimit = (
    grantId: string,
    change: Record<string, unknown>,
    headers: Record<string, string>,
  ) =>
    handle(
      new Request(`${ORIGIN}/api/account/grants/${grantId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp(), ...headers },
        body: JSON.stringify(change),
      }),
    );
  const asShopper = () => ({ cookie: agent.customerCookie });
  // signUpCustomer's password: raising a limit asks for it again.
  const confirmed = { confirm: { password: "correct horse battery" } };
  const errorOf = async (response: Response) => [
    response.status,
    ((await response.json()) as { error: string }).error,
  ];
  const post = (path: string, body: unknown, cookie: string) =>
    handle(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp(), cookie },
        body: JSON.stringify(body),
      }),
    );
  // The tests' origin is 127.0.0.1, which WebAuthn refuses as an RP ID; passkeys use localhost.
  const passkeyOf = async (cookie: string) => {
    const authenticator = await SoftAuthenticator.create("http://localhost:8003");
    const options = await (await post("/api/passkeys/register/options", confirmed, cookie)).json();
    const response = await authenticator.register(options.options);
    const saved = await post(
      "/api/passkeys/register/verify",
      { challengeId: options.challengeId, response },
      cookie,
    );
    expect(saved.status).toBe(200);
    return authenticator;
  };
  const passkeyConfirm = async (cookie: string, authenticator: SoftAuthenticator) => {
    const options = await (await post("/api/account/confirm/options", {}, cookie)).json();
    return {
      challengeId: options.challengeId,
      response: await authenticator.login(options.options),
    };
  };
  // The incident's state: a EUR 150 grant with EUR 149 spent.
  const spent149 = () => {
    const [grant] = grants();
    put("grants", grant!.id, { ...grant!, spent: 14900 });
    return grant!;
  };
  const eur = (amount: number) => ({ amount, currency: "EUR" });

  test("with EUR 1 left a EUR 63.95 checkout goes to the shopper and names where the limit is raised", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const grant = spent149();
    const manage = `${ORIGIN}/account#agent-${grant.id}`;
    const created = await shirt();
    expect(created.status).toBe("requires_escalation");
    expect(created.totals.find((t: { type: string }) => t.type === "total").amount).toBe(6395);
    expect(created.continue_url).toBe(`${ORIGIN}/checkout/${created.id}`);
    const message = created.messages.find(
      (m: { code: string }) => m.code === "spend_limit_exceeded",
    );
    expect(message.content).toContain("continue_url");
    expect(message.content).toContain(manage);
    expect(created.agent_budget).toEqual({
      spend_limit: eur(15000),
      spent: eur(14900),
      remaining: eur(100),
      manage_url: manage,
    });
    expect((await pay(created.id)).content.status).toBe("requires_escalation");
    expect(fake.payments).toHaveLength(0);
  });

  test("raised from EUR 150 to 220, EUR 71 is left; the agent pays on the same grant and EUR 7.05 remain", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const grant = spent149();
    const created = await shirt();
    expect(created.status).toBe("requires_escalation");
    expect(
      (await setLimit(grant.id, { spendLimit: 22000, ...confirmed }, asShopper())).status,
    ).toBe(200);
    const before = await read(created.id);
    expect([before.status, before.agent_budget.remaining]).toEqual([
      "ready_for_complete",
      eur(7100),
    ]);
    const paid = (await pay(created.id)).content;
    expect(paid.status).toBe("completed");
    expect(paid.agent_budget).toMatchObject({ spent: eur(21295), remaining: eur(705) });
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({ id: grant.id, spendLimit: 22000, spent: 21295 });
    expect(fake.payments).toHaveLength(1);
  });

  test("a lower limit stops the next payment, on a checkout opened before; what was spent stays", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const [grant] = grants();
    const created = await shirt();
    expect(created.status).toBe("ready_for_complete");
    expect((await setLimit(grant!.id, { spendLimit: 5000 }, asShopper())).status).toBe(200);
    expect((await pay(created.id)).content.status).toBe("requires_escalation");
    expect(fake.payments).toHaveLength(0);
    spent149();
    expect((await setLimit(grant!.id, { spendLimit: 4000 }, asShopper())).status).toBe(200);
    expect((await read(created.id)).agent_budget).toMatchObject({
      spend_limit: eur(4000),
      spent: eur(14900),
      remaining: eur(0),
    });
  });

  test("only the account's signed-in shopper changes a limit, up to EUR 1000, and not once the agent is disconnected", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const [grant] = grants();
    const other = await signUpCustomer();
    expect(
      (await setLimit(grant!.id, { spendLimit: 99900 }, { cookie: other.cookie })).status,
    ).toBe(404);
    const bearer = { authorization: `Bearer ${agent.accessToken}` };
    expect((await setLimit(grant!.id, { spendLimit: 99900 }, bearer)).status).toBe(401);
    expect(grants()[0]!.spendLimit).toBe(15000);
    expect(
      (await setLimit(grant!.id, { spendLimit: 500_000, ...confirmed }, asShopper())).status,
    ).toBe(200);
    expect(grants()[0]!.spendLimit).toBe(100_000);
    expect((await setLimit(grant!.id, { revoked: true }, asShopper())).status).toBe(200);
    const raised = await setLimit(grant!.id, { spendLimit: 90_000 }, asShopper());
    expect(raised.status).toBe(409);
    expect(grants()[0]).toMatchObject({ revoked: true, spendLimit: 100_000 });
  });

  test("raising a limit asks for the password again; a wrong one changes nothing; lowering does not ask", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const [grant] = grants();
    const raise = (extra: Record<string, unknown> = {}) =>
      setLimit(grant!.id, { spendLimit: 22000, ...extra }, asShopper());
    expect(await errorOf(await raise())).toEqual([401, "confirmation_required"]);
    expect(await errorOf(await raise({ confirm: {} }))).toEqual([401, "confirmation_required"]);
    const wrong = { confirm: { password: "not the password" } };
    expect(await errorOf(await raise(wrong))).toEqual([401, "invalid_login"]);
    expect(grants()[0]!.spendLimit).toBe(15000);
    expect((await raise(confirmed)).status).toBe(200);
    expect(grants()[0]!.spendLimit).toBe(22000);
    const shown = recentTrace(10, grant!.id).find((e) => e.path === "/account/grants");
    expect(shown?.detail).toEqual({ revoked: false, spendLimit: 22000, confirmedBy: "password" });
    expect((await setLimit(grant!.id, { spendLimit: 22000 }, asShopper())).status).toBe(200);
    expect((await setLimit(grant!.id, { spendLimit: 9000 }, asShopper())).status).toBe(200);
    expect((await setLimit(grant!.id, { revoked: true }, asShopper())).status).toBe(200);
    expect(grants()[0]).toMatchObject({ spendLimit: 9000, revoked: true });
  });

  test("wrong passwords at the confirmation count toward the account's sign-in limit", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const [grant] = grants();
    const wrong = { spendLimit: 22000, confirm: { password: "not the password" } };
    for (let i = 0; i < 10; i++)
      expect((await setLimit(grant!.id, wrong, asShopper())).status).toBe(401);
    const locked = await setLimit(grant!.id, { spendLimit: 22000, ...confirmed }, asShopper());
    expect(await errorOf(locked)).toEqual([429, "too_many_attempts"]);
    expect(grants()[0]!.spendLimit).toBe(15000);
    // The same counter as sign-in: the right password is refused there too, from a new address.
    const email = customerFromCookies(agent.customerCookie)!.email;
    const signIn = await handle(
      new Request(`${ORIGIN}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
        body: JSON.stringify({ email, password: confirmed.confirm.password }),
      }),
    );
    expect(await errorOf(signIn)).toEqual([429, "too_many_attempts"]);
  });

  test("a passkey of this account confirms a raise, once; another account's passkey or challenge does not", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const [grant] = grants();
    const raise = (spendLimit: number, confirm: unknown) =>
      setLimit(grant!.id, { spendLimit, confirm }, asShopper());
    const other = await signUpCustomer();
    expect(await errorOf(await post("/api/account/confirm/options", {}, other.cookie))).toEqual([
      409,
      "no_passkey",
    ]);
    expect((await post("/api/account/confirm/options", {}, "")).status).toBe(401);
    const own = await passkeyOf(agent.customerCookie);
    const stranger = await passkeyOf(other.cookie);

    const foreignKey = await passkeyConfirm(agent.customerCookie, stranger);
    expect(await errorOf(await raise(22000, foreignKey))).toEqual([401, "invalid_passkey"]);
    const foreignChallenge = await passkeyConfirm(other.cookie, own);
    expect(await errorOf(await raise(22000, foreignChallenge))).toEqual([401, "invalid_passkey"]);
    const login = await (await post("/api/passkeys/login/options", {}, "")).json();
    const signInChallenge = {
      challengeId: login.challengeId,
      response: await own.login(login.options, "localhost"),
    };
    expect(await errorOf(await raise(22000, signInChallenge))).toEqual([401, "invalid_passkey"]);
    expect(grants()[0]!.spendLimit).toBe(15000);

    const confirm = await passkeyConfirm(agent.customerCookie, own);
    expect((await raise(22000, confirm)).status).toBe(200);
    expect(await errorOf(await raise(30000, confirm))).toEqual([401, "invalid_passkey"]);
    expect(grants()[0]!.spendLimit).toBe(22000);
  });

  test("handing the checkout to the shopper reserves nothing of the agent's limit", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const created = await shirt();
    const handed = await agent.tool("complete_checkout", {
      meta: { "idempotency-key": crypto.randomUUID() },
      id: created.id,
      checkout: { payment: { instruments: [] } },
    });
    expect(handed.content.status).toBe("requires_escalation");
    expect(grants()[0]!.spent).toBe(0);
    expect((await read(created.id)).agent_budget.remaining).toEqual(eur(15000));
  });

  test("a limit posted as NaN at the consent is stored as zero, not as a limit that never caps", async () => {
    await agent.signIn({ spendLimitEur: Number.NaN });
    expect(grants()[0]!.spendLimit).toBe(0);
  });

  test("complete_checkout answers from the grant as it stands, not as the token found it", async () => {
    await agent.signIn({ spendLimitEur: 150 });
    const [grant] = grants();
    const created = await shirt();
    expect(created.status).toBe("ready_for_complete");
    const stale = authenticate(`Bearer ${agent.accessToken}`, "/mcp");
    if (!stale || stale === "invalid") throw new Error("the agent's token should be valid");
    put("grants", grant!.id, { ...grant!, spendLimit: 5000 });
    const answer = await OPERATIONS.complete_checkout!(
      { id: created.id, checkout: { payment: { instruments: [instrument()] } } },
      { auth: stale },
    );
    expect(answer.body).toMatchObject({
      status: "requires_escalation",
      agent_budget: { spend_limit: eur(5000), remaining: eur(5000) },
    });
    expect(fake.payments).toHaveLength(0);
  });
});

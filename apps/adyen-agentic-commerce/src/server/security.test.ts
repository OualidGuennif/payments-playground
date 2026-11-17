// TEST-only configuration, redaction of everything secret, HMAC-checked webhooks, the rate limit
// and the shopper data a browser page may see.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { hmacValidator } from "@adyen/api-library";
import { handle } from "./api";
import * as commerce from "./commerce";
import { ConfigError, readConfig } from "./config";
import { basicAuthAllows, crossSiteRefused } from "../proxy";
import { list, put } from "./db";
import { clientIp, rateLimited, trackedRateAddresses } from "./protocol";
import { recentTrace, redact } from "./trace";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { fake } from "./testing/fake-adyen";

const HMAC_KEY = process.env.ADYEN_HMAC_KEY!;
const SOCKS = "velune-rib-socks-oat-one-size";

beforeEach(() => freshStore());

describe("configuration", () => {
  const base = { PUBLIC_ORIGIN: "https://shop.example" };

  test("only the TEST environment is accepted", () => {
    expect(() => readConfig({ ...base, ADYEN_ENVIRONMENT: "LIVE" })).toThrow(ConfigError);
    expect(readConfig({ ...base, ADYEN_ENVIRONMENT: "test" }).publicOrigin).toBe(
      "https://shop.example",
    );
  });

  test("a LIVE client key fails closed", () => {
    expect(() => readConfig({ ...base, ADYEN_CLIENT_KEY: "live_ABC" })).toThrow(ConfigError);
  });

  test("PUBLIC_ORIGIN must be a bare origin", () => {
    expect(() => readConfig({ PUBLIC_ORIGIN: "https://shop.example/store" })).toThrow(ConfigError);
    expect(() => readConfig({ PUBLIC_ORIGIN: "not a url" })).toThrow(ConfigError);
  });

  test("the Back Office password needs both a user and a password", () => {
    expect(readConfig({ ...base, PLAYGROUND_BASIC_AUTH_USER: "owner" }).backOffice).toBeUndefined();
    expect(
      readConfig({
        ...base,
        PLAYGROUND_BASIC_AUTH_USER: "owner",
        PLAYGROUND_BASIC_AUTH_PASSWORD: "pw",
      }).backOffice,
    ).toEqual({ user: "owner", password: "pw" });
  });

  test("dotenv quotes kept by docker --env-file are stripped, a lone quote is not", () => {
    const quoted = readConfig({
      PUBLIC_ORIGIN: '"https://shop.example"',
      ADYEN_MERCHANT_ACCOUNT: "'Merchant'",
      ADYEN_CLIENT_KEY: '"test_ABC"',
      ADYEN_HMAC_KEY: '"AB12"',
    });
    expect(quoted.publicOrigin).toBe("https://shop.example");
    expect(quoted.adyen).toEqual({
      apiKey: undefined,
      merchantAccount: "Merchant",
      clientKey: "test_ABC",
      hmacKey: "AB12",
    });
    expect(readConfig({ ...base, ADYEN_MERCHANT_ACCOUNT: '"Merchant' }).adyen.merchantAccount).toBe(
      '"Merchant',
    );
    expect(readConfig({ ...base, ADYEN_API_KEY: '""' }).adyen.apiKey).toBeUndefined();
    expect(() => readConfig({ ...base, ADYEN_CLIENT_KEY: '"live_ABC"' })).toThrow(ConfigError);
  });
});

describe("redaction", () => {
  test("tokens, codes, assertions, card ids and signatures are redacted at any depth", () => {
    const out = JSON.stringify(
      redact({
        authorization: "Bearer at_x",
        form: { code: "abc", code_verifier: "v", client_assertion: "eyJ", refresh_token: "rt_x" },
        card: [{ storedPaymentMethodId: "TEST_STORED_VISA_1111" }],
        additionalData: { hmacSignature: "sig" },
        "poppy-session": "eyJ",
      }),
    );
    for (const secret of ["at_x", "abc", "eyJ", "rt_x", "TEST_STORED_VISA_1111", "sig"])
      expect(out).not.toContain(`"${secret}"`);
    expect(out).not.toContain("Bearer");
  });

  test("a UCP message keeps its public code", () => {
    expect(
      redact({
        type: "error",
        code: "payment_refused",
        content: "Refused",
        severity: "requires_buyer_review",
      }),
    ).toMatchObject({ code: "payment_refused" });
  });

  test("long strings are cut", () => {
    expect(String(redact("x".repeat(1000))).length).toBeLessThan(410);
  });
});

describe("an agent payment leaves no secret behind", () => {
  let agent: TestAgent;
  beforeAll(async () => {
    agent = await TestAgent.start("Trace agent");
  });
  afterAll(() => agent.stop());

  test("the trace and the account page hold no token, assertion or stored card id", async () => {
    agent.ip = randomIp();
    await agent.signIn();
    const { content } = await agent.tool("create_checkout", {
      checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
    });
    const alias = content.payment.instruments[0].id;
    expect(
      (
        await agent.tool("complete_checkout", {
          id: content.id,
          checkout: { payment: { instruments: [{ id: alias }] } },
        })
      ).content.status,
    ).toBe("completed");

    const trace = JSON.stringify(recentTrace(500));
    for (const secret of [
      agent.accessToken,
      agent.refreshToken,
      "TEST_STORED_VISA_1111",
      agent.delegation,
    ]) {
      expect(trace).not.toContain(secret);
    }
    expect(trace).toContain("UnscheduledCardOnFile");

    const account = await (await handle(new Request(`${ORIGIN}/api/account`))).text();
    expect(account).not.toContain("TEST_STORED_VISA_1111");
    expect(account).toContain(alias);
  });
});

describe("webhooks", () => {
  function notification(item: Record<string, unknown>, sign = true) {
    const signed = { ...item, additionalData: {} as Record<string, string> };
    if (sign)
      signed.additionalData.hmacSignature = new hmacValidator().calculateHmac(
        signed as never,
        HMAC_KEY,
      );
    return handle(
      new Request(`${ORIGIN}/api/webhooks/adyen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          live: "false",
          notificationItems: [{ NotificationRequestItem: signed }],
        }),
      }),
    );
  }

  const authorisation = (reference: string, success: boolean) => ({
    pspReference: "PSPWEBHOOK",
    merchantReference: reference,
    merchantAccountCode: "FakeMerchantECOM",
    eventCode: "AUTHORISATION",
    success: String(success),
    amount: { value: 1695, currency: "EUR" },
  });

  test("an unsigned or empty notification is rejected", async () => {
    expect((await notification(authorisation("x", true), false)).status).toBe(401);
    const empty = await handle(
      new Request(`${ORIGIN}/api/webhooks/adyen`, { method: "POST", body: "{}" }),
    );
    expect(empty.status).toBe(401);
  });

  test("a tampered amount breaks the signature", async () => {
    const item = { ...authorisation("x", true), additionalData: {} as Record<string, string> };
    item.additionalData.hmacSignature = new hmacValidator().calculateHmac(item as never, HMAC_KEY);
    item.amount = { value: 1, currency: "EUR" };
    const response = await handle(
      new Request(`${ORIGIN}/api/webhooks/adyen`, {
        method: "POST",
        body: JSON.stringify({ notificationItems: [{ NotificationRequestItem: item }] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("a signed AUTHORISATION confirms a Pending agent payment and places the order", async () => {
    const agent = await TestAgent.start("Webhook agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      fake.answers.push({ resultCode: "Pending" });
      const pending = await agent.tool("complete_checkout", {
        id: content.id,
        checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
      });
      expect(pending.content.status).toBe("complete_in_progress");

      const response = await notification(authorisation(`${content.id}-a1`, true));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("[accepted]");
      expect(list<commerce.Order>("orders")).toEqual([
        expect.objectContaining({
          checkoutId: content.id,
          pspReference: "PSPWEBHOOK",
          paidBy: "agent",
        }),
      ]);
    } finally {
      agent.stop();
    }
  });

  test("a late refusal of an earlier attempt leaves the pending one alone", async () => {
    const agent = await TestAgent.start("Late refusal agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      const pay = () =>
        agent.tool("complete_checkout", {
          id: content.id,
          checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
        });
      fake.answers.push({ resultCode: "Refused" });
      await pay();
      fake.answers.push({ resultCode: "Pending" });
      expect((await pay()).content.status).toBe("complete_in_progress");
      expect((await notification(authorisation(`${content.id}-a1`, false))).status).toBe(200);
      const after = (await agent.tool("get_checkout", { id: content.id })).content;
      expect(after.status).toBe("complete_in_progress");
      expect(after.agent_budget.spent.amount).toBe(1695);
    } finally {
      agent.stop();
    }
  });

  test("an AUTHORISATION for another amount places no order", async () => {
    const agent = await TestAgent.start("Odd amount agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      fake.answers.push({ resultCode: "Pending" });
      await agent.tool("complete_checkout", {
        id: content.id,
        checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
      });
      const odd = {
        ...authorisation(`${content.id}-a1`, true),
        amount: { value: 1, currency: "EUR" },
      };
      expect((await notification(odd)).status).toBe(200);
      expect(list<commerce.Order>("orders")).toHaveLength(0);
    } finally {
      agent.stop();
    }
  });

  test("a network error then Adyen's success webhook charges the budget once", async () => {
    const agent = await TestAgent.start("Lost answer agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      fake.answers.push(new Error("socket hang up"));
      await agent.tool("complete_checkout", {
        id: content.id,
        checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
      });
      expect(
        (await agent.tool("get_checkout", { id: content.id })).content.agent_budget.spent.amount,
      ).toBe(0);
      expect((await notification(authorisation(`${content.id}-a1`, true))).status).toBe(200);
      expect(list<commerce.Order>("orders")).toHaveLength(1);
      const after = (await agent.tool("get_checkout", { id: content.id })).content;
      expect(after.agent_budget.spent.amount).toBe(1695);
    } finally {
      agent.stop();
    }
  });

  test("a refusal webhook during the call and the refused answer give the budget back once", async () => {
    const agent = await TestAgent.start("Double refusal agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      fake.during = () => {
        commerce.applyNotification({
          ...authorisation(`${content.id}-a1`, false),
          pspReference: "PSPREFUSED",
        });
      };
      fake.answers.push({ resultCode: "Refused" });
      await agent.tool("complete_checkout", {
        id: content.id,
        checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
      });
      const after = (await agent.tool("get_checkout", { id: content.id })).content;
      expect(after.agent_budget.spent.amount).toBe(0);
      expect(after.status).toBe("ready_for_complete");
    } finally {
      agent.stop();
    }
  });

  for (const answer of ["Authorised", "a network error"] as const) {
    test(`a success webhook during the call, then ${answer}: one order, charged once`, async () => {
      const agent = await TestAgent.start(`Early webhook agent (${answer})`);
      try {
        await agent.signIn();
        const { content } = await agent.tool("create_checkout", {
          checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
        });
        fake.during = () => {
          commerce.applyNotification(authorisation(`${content.id}-a1`, true));
        };
        fake.answers.push(
          answer === "Authorised"
            ? { resultCode: "Authorised", pspReference: "PSPWEBHOOK" }
            : new Error("timeout"),
        );
        await agent.tool("complete_checkout", {
          id: content.id,
          checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
        });
        expect(list<commerce.Order>("orders")).toHaveLength(1);
        const after = (await agent.tool("get_checkout", { id: content.id })).content;
        expect(after.status).toBe("completed");
        expect(after.agent_budget.spent.amount).toBe(1695);
      } finally {
        agent.stop();
      }
    });
  }

  test("a webhook finds its payment behind more than 200 newer ones", async () => {
    const agent = await TestAgent.start("Old payment agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      fake.answers.push({ resultCode: "Pending" });
      await agent.tool("complete_checkout", {
        id: content.id,
        checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
      });
      for (let i = 0; i < 205; i += 1) {
        put("payments", `filler-${i}`, { id: `filler-${i}`, reference: `filler-${i}`, amount: 0 });
      }
      expect((await notification(authorisation(`${content.id}-a1`, true))).status).toBe(200);
      expect(list<commerce.Order>("orders")).toHaveLength(1);
    } finally {
      agent.stop();
    }
  });

  test("a signed refusal reopens a Pending checkout and gives the budget back", async () => {
    const agent = await TestAgent.start("Refused webhook agent");
    try {
      await agent.signIn();
      const { content } = await agent.tool("create_checkout", {
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
      fake.answers.push({ resultCode: "Pending" });
      await agent.tool("complete_checkout", {
        id: content.id,
        checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
      });
      expect((await notification(authorisation(`${content.id}-a1`, false))).status).toBe(200);
      const after = (await agent.tool("get_checkout", { id: content.id })).content;
      expect(after.status).toBe("ready_for_complete");
      expect(after.agent_budget.spent.amount).toBe(0);
      expect(list<commerce.Order>("orders")).toHaveLength(0);
    } finally {
      agent.stop();
    }
  });
});

describe("cross-site writes on shopper paths", () => {
  const OWN = ["https://agentic.example"];
  const from = (headers: Record<string, string>) => new Headers(headers);

  test("a cross-site or same-site browser POST is refused, a same-origin one passes", () => {
    expect(crossSiteRefused("POST", from({ "sec-fetch-site": "cross-site" }), OWN)).toBe(true);
    expect(crossSiteRefused("POST", from({ "sec-fetch-site": "same-site" }), OWN)).toBe(true);
    expect(crossSiteRefused("POST", from({ "sec-fetch-site": "same-origin" }), OWN)).toBe(false);
  });

  test("without Sec-Fetch-Site, Origin decides; a request with neither is not a browser's", () => {
    expect(crossSiteRefused("POST", from({ origin: "https://evil.example" }), OWN)).toBe(true);
    expect(crossSiteRefused("POST", from({ origin: "null" }), OWN)).toBe(true);
    expect(crossSiteRefused("DELETE", from({ origin: "https://agentic.example" }), OWN)).toBe(
      false,
    );
    expect(crossSiteRefused("POST", from({}), OWN)).toBe(false);
  });

  test("reads are never refused", () => {
    expect(crossSiteRefused("GET", from({ "sec-fetch-site": "cross-site" }), OWN)).toBe(false);
  });
});

describe("rate limit", () => {
  test("the 241st request in a minute from one client is limited", () => {
    const key = `rate-${crypto.randomUUID()}`;
    for (let i = 0; i < 240; i += 1) expect(rateLimited(key)).toBeUndefined();
    expect(rateLimited(key)).toBeGreaterThan(0);
  });

  test("the limiter keeps at most 10,000 addresses, however many are forged", () => {
    for (let i = 0; i < 10_050; i += 1) rateLimited(`forged-${crypto.randomUUID()}`);
    expect(trackedRateAddresses()).toBeLessThanOrEqual(10_000);
    // The address seen last is still counted.
    const key = `rate-${crypto.randomUUID()}`;
    for (let i = 0; i < 240; i += 1) rateLimited(key);
    expect(rateLimited(key)).toBeGreaterThan(0);
  });
});

// On Render, Cloudflare writes CF-Connecting-IP over any copy the caller sent and appends to
// X-Forwarded-For, so the first X-Forwarded-For entry is whatever the caller chose.
describe("client address", () => {
  const from = (headers: Record<string, string>) =>
    new Request(`${ORIGIN}/mcp`, { method: "POST", headers });
  const mcp = (headers: Record<string, string>) =>
    handle(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

  test("a forged first X-Forwarded-For entry is never the caller", () => {
    const caller = "198.51.100.4";
    const chain = `203.0.113.7, ${caller}`;
    expect(clientIp(from({ "cf-connecting-ip": caller, "x-forwarded-for": chain }))).toBe(caller);
    // Without Cloudflare's header, the entry the nearest proxy appended.
    expect(clientIp(from({ "x-forwarded-for": chain }))).toBe(caller);
  });

  test("without X-Forwarded-For Cloudflare's address counts; with no usable header, 'local'", () => {
    expect(clientIp(from({ "cf-connecting-ip": "2001:db8::5" }))).toBe("2001:db8::5");
    expect(clientIp(from({ "cf-connecting-ip": "::ffff:192.0.2.5" }))).toBe("192.0.2.5");
    expect(clientIp(from({}))).toBe("local");
    // A value that is not an address is no address: it cannot open a bucket of its own.
    expect(clientIp(from({ "x-forwarded-for": "not-an-ip" }))).toBe("local");
    expect(
      clientIp(from({ "cf-connecting-ip": "<script>", "x-forwarded-for": "198.51.100.9" })),
    ).toBe("198.51.100.9");
  });

  test("varying a forged first entry does not escape the limit", async () => {
    const caller = randomIp();
    const headers = () => ({
      "cf-connecting-ip": caller,
      "x-forwarded-for": `${randomIp()}, ${caller}`,
    });
    for (let i = 0; i < 240; i += 1) expect((await mcp(headers())).status).not.toBe(429);
    expect((await mcp(headers())).status).toBe(429);
  });

  test("a victim's address in the first entry does not get the victim limited", async () => {
    const victim = randomIp();
    const sender = randomIp();
    const forged = { "cf-connecting-ip": sender, "x-forwarded-for": `${victim}, ${sender}` };
    for (let i = 0; i < 240; i += 1) await mcp(forged);
    expect((await mcp(forged)).status).toBe(429);
    const own = await mcp({ "cf-connecting-ip": victim, "x-forwarded-for": victim });
    expect(own.status).toBe(401);
  });
});

describe("shopper pages basic auth", () => {
  const header = (pair: string) => `Basic ${btoa(pair)}`;
  const quoted = {
    PLAYGROUND_BASIC_AUTH_USER: '"shopper"',
    PLAYGROUND_BASIC_AUTH_PASSWORD: "'s3cret'",
  };

  test("quotes kept by docker --env-file are stripped before comparing", () => {
    expect(basicAuthAllows(header("shopper:s3cret"), quoted)).toBe(true);
    expect(basicAuthAllows(header(`"shopper":'s3cret'`), quoted)).toBe(false);
  });

  test("a wrong, missing or malformed header is refused when a pair is set", () => {
    expect(basicAuthAllows(header("shopper:wrong"), quoted)).toBe(false);
    expect(basicAuthAllows(null, quoted)).toBe(false);
    expect(basicAuthAllows("Basic %%%", quoted)).toBe(false);
  });

  test("without a configured pair the pages stay open", () => {
    expect(basicAuthAllows(null, {})).toBe(true);
    expect(basicAuthAllows(null, { PLAYGROUND_BASIC_AUTH_USER: "shopper" })).toBe(true);
  });
});

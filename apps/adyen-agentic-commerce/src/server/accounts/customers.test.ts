// Customer accounts (ADR-015): password and passkey sign-in, the session cookie, the limits on
// failures, agents that act for the account that approved them, and the web channel.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { backOfficeView, handle } from "../api";
import { SESSIONS_PER_MINUTE } from "./account-api";
import { type Checkout, sessionIdForReference } from "../commerce/commerce";
import { type Customer, customerFromCookies } from "./customers";
import { database, get, list, put } from "../core/db";
import { grants } from "../oauth/oauth";
import { SoftAuthenticator } from "../testing/authenticator";
import { fake } from "../testing/fake-adyen";
import { freshStore, ORIGIN, randomIp, signUpCustomer, TestAgent } from "../testing/agent";
import { ucpAgent } from "../testing/platform";
import { sha256 } from "../core/util";

const SOCKS = "velune-rib-socks-oat-one-size";
const PASSWORD = "correct horse battery";
// The tests' public origin is 127.0.0.1, which WebAuthn refuses as an RP ID; passkeys use localhost.
const PASSKEY_ORIGIN = "http://localhost:8003";

type Call = { body?: unknown; cookie?: string; ip?: string; headers?: Record<string, string> };
async function call(method: string, path: string, opts: Call = {}) {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? randomIp(),
    ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
    ...opts.headers,
  };
  const response = await handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await response.text();
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* an empty or plain answer */
  }
  return { status: response.status, headers: response.headers, body };
}

const cookieOf = (headers: Headers) => headers.get("set-cookie")?.split(";")[0] ?? "";
const signIn = (email: string, password: string, ip?: string) =>
  call("POST", "/api/session", { body: { email, password }, ip });

beforeEach(() => freshStore());

const CHECK = "/api/session/check-email";
const STORE_PAGE = { "x-velune-check": "1", "sec-fetch-site": "same-origin", origin: ORIGIN };
const check = (email: unknown, ip?: string, headers: Record<string, string> = STORE_PAGE) =>
  call("POST", CHECK, { body: { email }, ip, headers });

describe("the email check (ADR-020)", () => {
  test("the email check answers only whether an account exists, never fast", async () => {
    await signUpCustomer("ada@example.com");
    const started = performance.now();
    const unknown = await check("nobody@example.com");
    expect(performance.now() - started).toBeGreaterThanOrEqual(44);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ exists: false });
    expect(Object.keys(unknown.body)).toEqual(["exists"]);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    const known = await check("  Ada@Example.COM ");
    expect(known.status).toBe(200);
    expect(known.body).toEqual({ exists: true });
    expect(Object.keys(known.body)).toEqual(["exists"]);
    // Sign-in still tells nothing: the same refusal for an unknown email and a wrong password.
    const wrong = await signIn("ada@example.com", "wrong password here");
    const missing = await signIn("nobody@example.com", "wrong password here");
    expect([wrong.status, wrong.body]).toEqual([missing.status, missing.body]);
  });

  test("the email check refuses another site and a request without its header", async () => {
    await signUpCustomer("ada@example.com");
    const refused: Record<string, string>[] = [
      {},
      { "x-velune-check": "0", "sec-fetch-site": "same-origin" },
      { "x-velune-check": "1", "sec-fetch-site": "cross-site" },
      { "x-velune-check": "1", "sec-fetch-site": "same-site" },
      { "x-velune-check": "1", origin: "https://attacker.example" },
    ];
    for (const headers of refused) {
      const answer = await check("ada@example.com", undefined, headers);
      expect([answer.status, answer.body.error]).toEqual([403, "forbidden"]);
      expect(answer.body.exists).toBeUndefined();
    }
    expect((await check("ada@example.com")).body).toEqual({ exists: true });
  });

  test("the email check refuses a malformed email or body with 400 invalid_email", async () => {
    for (const email of ["", "   ", "not-an-email", "a@b", 42, null, `${"a".repeat(250)}@x.io`]) {
      const answer = await check(email);
      expect([answer.status, answer.body.error]).toEqual([400, "invalid_email"]);
    }
    const extra = await call("POST", CHECK, {
      body: { email: "ada@example.com", name: "Ada" },
      headers: STORE_PAGE,
    });
    expect(extra.status).toBe(400);
    const notJson = await handle(
      new Request(`${ORIGIN}${CHECK}`, {
        method: "POST",
        headers: { ...STORE_PAGE, "content-type": "text/plain", "x-forwarded-for": randomIp() },
        body: "ada@example.com",
      }),
    );
    expect(notJson.status).toBe(400);
  });

  test("the email check allows 15 per address per 15 minutes and keeps the email masked", async () => {
    await signUpCustomer("ada@example.com");
    const ip = randomIp();
    for (let i = 0; i < 15; i++) {
      // Malformed bodies count too: the allowance is spent before the body is read.
      const answer = await check(i % 2 ? "ada@example.com" : "bad", ip);
      expect([200, 400]).toContain(answer.status);
    }
    const limited = await check("ada@example.com", ip);
    expect([limited.status, limited.body.error]).toEqual([429, "rate_limited"]);
    const retry = Number(limited.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(14 * 60);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    expect((await check("ada@example.com")).status).toBe(200);
    const trace = JSON.stringify(database().query("select * from trace").all());
    expect(trace).toContain("/api/session/check-email");
    expect(trace).not.toContain("ada@example.com");
    expect(trace).toContain("a•••@example.com");
  });
});

describe("accounts", () => {
  test("sign-up starts a session: HttpOnly, SameSite=Lax, 7 days, stored only as its SHA-256", async () => {
    const created = await call("POST", "/api/customers", {
      body: { email: "Ada@Example.com", password: PASSWORD, name: "Ada" },
    });
    expect(created.status).toBe(200);
    expect(created.body.customer).toEqual({ email: "ada@example.com", name: "Ada" });
    const header = created.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${7 * 24 * 3600}`);
    // A loopback http origin keeps no __Host- or Secure cookie; https gets both (see the spec).
    expect(header.startsWith("velune_session=")).toBe(true);
    const token = cookieOf(created.headers).split("=")[1]!;
    const dump = JSON.stringify(
      database().query("select data from docs where collection like 'customer%'").all(),
    );
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).toContain(sha256(token));
    expect(dump).toContain("$argon2id$");
    const me = await call("GET", "/api/session", { cookie: cookieOf(created.headers) });
    expect(me.body.customer.email).toBe("ada@example.com");
  });

  test("a taken email is 409, a short or long password 400, a bad email 400", async () => {
    await signUpCustomer("ada@example.com");
    const taken = await call("POST", "/api/customers", {
      body: { email: "ADA@example.com", password: PASSWORD },
    });
    expect([taken.status, taken.body.error]).toEqual([409, "email_taken"]);
    for (const password of ["short", "x".repeat(129)]) {
      const weak = await call("POST", "/api/customers", {
        body: { email: "bob@example.com", password },
      });
      expect([weak.status, weak.body.error]).toEqual([400, "weak_password"]);
    }
    const bad = await call("POST", "/api/customers", {
      body: { email: "not-an-email", password: PASSWORD },
    });
    expect(bad.status).toBe(400);
    expect(list<Customer>("customers")).toHaveLength(1);
  });

  test("an unknown email and a wrong password get the same 401 invalid_login", async () => {
    await signUpCustomer("ada@example.com");
    const wrong = await signIn("ada@example.com", "wrong password here");
    const unknown = await signIn("nobody@example.com", PASSWORD);
    expect(wrong).toMatchObject({ status: 401, body: { error: "invalid_login" } });
    expect(unknown).toMatchObject({ status: 401, body: wrong.body });
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const right = await signIn("ada@example.com", PASSWORD);
    expect(right.status).toBe(200);
    expect(customerFromCookies(cookieOf(right.headers))?.email).toBe("ada@example.com");
  });

  test("ten failures from one address refuse it, the right password included", async () => {
    await signUpCustomer("ada@example.com");
    const ip = randomIp();
    for (let i = 0; i < 10; i++) await signIn("ada@example.com", `wrong ${i} password`, ip);
    const blocked = await signIn("ada@example.com", PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("too_many_attempts");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  test("a burst of wrong passwords sent at once meets the same limit; right ones never count", async () => {
    await signUpCustomer("ada@example.com");
    const ip = randomIp();
    for (let i = 0; i < 15; i++)
      expect((await signIn("ada@example.com", PASSWORD, ip)).status).toBe(200);
    const burst = await Promise.all(
      Array.from({ length: 30 }, (_, i) => signIn("ada@example.com", `wrong ${i} password`, ip)),
    );
    const statuses = burst.map((answer) => answer.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);
    expect((await signIn("ada@example.com", PASSWORD, ip)).status).toBe(429);
  });

  test("ten failures on one account from many addresses refuse that account", async () => {
    await signUpCustomer("ada@example.com");
    await signUpCustomer("bob@example.com");
    for (let i = 0; i < 10; i++) await signIn("ada@example.com", `wrong ${i} password`);
    expect((await signIn("ada@example.com", PASSWORD)).status).toBe(429);
    expect((await signIn("bob@example.com", PASSWORD)).status).toBe(200);
  });

  test("sign-out deletes the session; an expired session reads as signed out", async () => {
    const { cookie } = await signUpCustomer();
    expect((await call("GET", "/api/account", { cookie })).status).toBe(200);
    const out = await call("DELETE", "/api/session", { cookie });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await call("GET", "/api/account", { cookie })).toMatchObject({
      status: 401,
      body: { error: "sign_in_required" },
    });

    const again = (await signUpCustomer()).cookie;
    const id = sha256(again.split("=")[1]!);
    put("customer_sessions", id, {
      ...get<Record<string, unknown>>("customer_sessions", id)!,
      expiresAt: 1,
    });
    expect(customerFromCookies(again)).toBeUndefined();
  });

  test("every account route needs the session; a bearer token is not one", async () => {
    const agent = await TestAgent.start("Bearer only");
    try {
      await agent.signIn();
      const bearer = { authorization: `Bearer ${agent.accessToken}` };
      for (const [method, path] of [
        ["GET", "/api/account"],
        ["POST", "/api/account/card-session"],
        ["POST", "/api/passkeys/register/options"],
      ] as const) {
        const answer = await call(method, path, { headers: bearer });
        expect([path, answer.status, answer.body.error]).toEqual([path, 401, "sign_in_required"]);
      }
    } finally {
      agent.stop();
    }
  });
});

describe("passkeys", () => {
  async function register(cookie: string, authenticator: SoftAuthenticator) {
    const options = await call("POST", "/api/passkeys/register/options", {
      cookie,
      body: { confirm: { password: PASSWORD } },
    });
    expect(options.status).toBe(200);
    const response = await authenticator.register(options.body.options);
    return call("POST", "/api/passkeys/register/verify", {
      cookie,
      body: { challengeId: options.body.challengeId, response },
    });
  }

  test("a passkey registered while signed in then signs in alone; its challenge is used once", async () => {
    const { cookie } = await signUpCustomer("ada@example.com");
    const authenticator = await SoftAuthenticator.create(PASSKEY_ORIGIN);
    const registered = await register(cookie, authenticator);
    expect(registered.status).toBe(200);
    expect(registered.body.passkeys).toHaveLength(1);
    const stored = JSON.stringify(list("passkeys"));
    expect(stored).toContain(authenticator.id);

    const options = await call("POST", "/api/passkeys/login/options", {});
    const response = await authenticator.login(options.body.options, "localhost");
    const body = { challengeId: options.body.challengeId, response };
    const signedIn = await call("POST", "/api/passkeys/login/verify", { body });
    expect(signedIn.status).toBe(200);
    expect(customerFromCookies(cookieOf(signedIn.headers))?.email).toBe("ada@example.com");
    const replay = await call("POST", "/api/passkeys/login/verify", { body });
    expect([replay.status, replay.body.error]).toEqual([401, "invalid_passkey"]);
  });

  test("registering needs a session, and a login challenge cannot register", async () => {
    expect((await call("POST", "/api/passkeys/register/options", {})).status).toBe(401);
    const { cookie } = await signUpCustomer();
    const authenticator = await SoftAuthenticator.create(PASSKEY_ORIGIN);
    const login = await call("POST", "/api/passkeys/login/options", {});
    const response = await authenticator.register({
      challenge: login.body.options.challenge,
      rp: { id: "localhost" },
    });
    const wrong = await call("POST", "/api/passkeys/register/verify", {
      cookie,
      body: { challengeId: login.body.challengeId, response },
    });
    expect([wrong.status, wrong.body.error]).toEqual([401, "invalid_passkey"]);
    expect(list("passkeys")).toHaveLength(0);
  });

  test("a key signed for another site, or unknown here, signs no one in", async () => {
    const { cookie } = await signUpCustomer();
    const authenticator = await SoftAuthenticator.create(PASSKEY_ORIGIN);
    await register(cookie, authenticator);
    const options = await call("POST", "/api/passkeys/login/options", {});
    const elsewhere = await authenticator.login(options.body.options, "evil.example");
    const refused = await call("POST", "/api/passkeys/login/verify", {
      body: { challengeId: options.body.challengeId, response: elsewhere },
    });
    expect([refused.status, refused.headers.get("set-cookie")]).toEqual([401, null]);

    const stranger = await SoftAuthenticator.create(PASSKEY_ORIGIN);
    const again = await call("POST", "/api/passkeys/login/options", {});
    const unknown = await call("POST", "/api/passkeys/login/verify", {
      body: {
        challengeId: again.body.challengeId,
        response: await stranger.login(again.body.options, "localhost"),
      },
    });
    expect(unknown.status).toBe(401);
  });

  test("a session alone cannot add a passkey: the password or an existing passkey confirms it", async () => {
    const { cookie } = await signUpCustomer();
    const options = (body?: unknown) =>
      call("POST", "/api/passkeys/register/options", { cookie, body });
    const refused = await options();
    expect([refused.status, refused.body.error]).toEqual([401, "confirmation_required"]);
    const wrong = await options({ confirm: { password: "not the password" } });
    expect([wrong.status, wrong.body.error]).toEqual([401, "invalid_login"]);
    const first = await SoftAuthenticator.create(PASSKEY_ORIGIN);
    expect((await register(cookie, first)).status).toBe(200);
    const confirmOptions = await call("POST", "/api/account/confirm/options", { cookie });
    const confirm = {
      challengeId: confirmOptions.body.challengeId,
      response: await first.login(confirmOptions.body.options),
    };
    const second = await options({ confirm });
    expect(second.status).toBe(200);
    expect(second.body.challengeId).toEqual(expect.any(String));
    expect(list("passkeys")).toHaveLength(1);
  });

  test("an account removes its own passkeys only", async () => {
    const ada = await signUpCustomer();
    const bob = await signUpCustomer();
    const authenticator = await SoftAuthenticator.create(PASSKEY_ORIGIN);
    await register(ada.cookie, authenticator);
    const path = `/api/passkeys/${authenticator.id}`;
    expect((await call("DELETE", path, { cookie: bob.cookie })).status).toBe(404);
    expect(list("passkeys")).toHaveLength(1);
    expect((await call("DELETE", path, { cookie: ada.cookie })).body.passkeys).toEqual([]);
  });
});

describe("agents act for an account", () => {
  let agent: TestAgent;
  beforeAll(async () => {
    agent = await TestAgent.start("Account agent");
  });
  afterAll(() => agent.stop());
  beforeEach(() => {
    agent.ip = randomIp();
    agent.customerCookie = "";
  });

  test("consent or a device code without a signed-in customer grants nothing", async () => {
    const { requestId } = await agent.authorize();
    const back = await agent.decide(requestId!, { cookie: "" });
    expect(back.pathname).toBe("/sign-in");
    expect(back.searchParams.get("next")).toBe(`/consent/${requestId}`);
    expect(grants()).toHaveLength(0);

    const verify = await handle(
      new Request(`${ORIGIN}/oauth/device/verify`, {
        method: "POST",
        body: new URLSearchParams({ user_code: "BCDF-GHJK" }),
      }),
    );
    const location = new URL(verify.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/device?user_code=BCDF-GHJK");

    // The same request, once signed in, is still there to approve.
    const approved = await agent.decide(requestId!);
    expect(approved.searchParams.get("code")).toBeTruthy();
    const [grant] = grants();
    expect(grant!.customerId).toBe(customerFromCookies(agent.customerCookie)!.id);
  });

  test("a grant without an account, made before accounts, authenticates nothing", async () => {
    await agent.signIn();
    const [grant] = grants();
    put("grants", grant!.id, { ...grant!, customerId: undefined });
    const answer = await agent.mcp("tools/list");
    expect(answer.status).toBe(401);
  });

  test("the agent sees the cards of its own account, looked up by that account's reference", async () => {
    await agent.signIn();
    const customer = customerFromCookies(agent.customerCookie)!;
    const { content } = await agent.tool("create_checkout", {
      checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
    });
    expect(content.payment.instruments).toHaveLength(1);
    expect(fake.lookups).toContain(customer.id);
    expect(fake.lookups.every((ref) => ref === customer.id)).toBe(true);
  });

  test("one agent client signed in for two accounts keeps their checkouts and orders apart", async () => {
    await agent.signIn();
    const { content } = await agent.tool("create_checkout", {
      checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
    });
    const paid = await agent.tool("complete_checkout", {
      id: content.id,
      checkout: { payment: { instruments: [{ id: content.payment.instruments[0].id }] } },
    });
    const orderId = paid.content.order.id;
    const order = get<Record<string, unknown>>("orders", orderId)!;
    expect(order.customerId).toBe(customerFromCookies(agent.customerCookie)!.id);
    expect(order.channel).toBe("agent");

    agent.customerCookie = (await signUpCustomer()).cookie;
    await agent.signIn();
    expect((await agent.tool("get_checkout", { id: content.id })).isError).toBe(true);
    expect((await agent.tool("get_order", { id: orderId })).isError).toBe(true);
  });

  test("one agent client's Idempotency-Key never replays one account's answer to another", async () => {
    const create = () =>
      agent.tool("create_checkout", {
        meta: { "idempotency-key": "shared-key-1" },
        checkout: { line_items: [{ item: { id: SOCKS }, quantity: 1 }] },
      });
    await agent.signIn();
    const first = (await create()).content;
    expect((await create()).content.id).toBe(first.id);
    agent.customerCookie = (await signUpCustomer()).cookie;
    await agent.signIn();
    const second = (await create()).content;
    expect(second.id).not.toBe(first.id);
    expect(JSON.stringify(second)).not.toContain(first.id);
  });

  test("an account keeps seeing, and can revoke, an old agent however many grants came since", async () => {
    await agent.signIn();
    const [grant] = grants();
    for (let i = 0; i < 205; i++)
      put("grants", `grant_other_${i}`, { id: `grant_other_${i}`, customerId: "cus_someone_else" });
    const account = await call("GET", "/api/account", { cookie: agent.customerCookie });
    expect(account.body.agents.map((a: { id: string }) => a.id)).toEqual([grant!.id]);
    const revoked = await call("POST", `/api/account/grants/${grant!.id}`, {
      cookie: agent.customerCookie,
      body: { revoked: true },
    });
    expect(revoked.status).toBe(200);
    expect(get<{ revoked: boolean }>("grants", grant!.id)!.revoked).toBe(true);
  });

  test("another account cannot change this account's agents", async () => {
    await agent.signIn();
    const [grant] = grants();
    const other = await signUpCustomer();
    const changed = await call("POST", `/api/account/grants/${grant!.id}`, {
      cookie: other.cookie,
      body: { revoked: true },
    });
    expect(changed.status).toBe(404);
    expect(grants()[0]!.revoked).toBe(false);
    const own = await call("GET", "/api/account", { cookie: agent.customerCookie });
    expect(own.body.agents.map((a: { id: string }) => a.id)).toEqual([grant!.id]);
    expect((await call("GET", "/api/account", { cookie: other.cookie })).body.agents).toEqual([]);
  });
});

describe("web channel", () => {
  const checkoutBody = { lines: [{ variantId: SOCKS, quantity: 1 }], email: "ada@example.com" };

  test("the browser API ignores a bearer token; the checkout is web and the session's", async () => {
    const agent = await TestAgent.start("Browser bearer");
    try {
      await agent.signIn();
      const ada = await signUpCustomer();
      const created = await call("POST", "/api/checkouts", {
        cookie: ada.cookie,
        headers: { authorization: `Bearer ${agent.accessToken}` },
        body: checkoutBody,
      });
      const checkout = get<Checkout>("checkouts", created.body.id)!;
      expect(checkout.channel).toBe("web");
      expect(checkout.clientId).toBeUndefined();
      expect(checkout.grantId).toBeUndefined();
      expect(checkout.customerId).toBe(customerFromCookies(ada.cookie)!.id);
      // And the protocol side does not reach it.
      expect((await agent.tool("get_checkout", { id: checkout.id })).isError).toBe(true);
    } finally {
      agent.stop();
    }
  });

  test("a shopper's checkout made before channels existed stays out of the protocol's reach", async () => {
    const { body } = await call("POST", "/api/checkouts", { body: checkoutBody });
    const { channel: _, ...legacy } = get<Checkout>("checkouts", body.id)!;
    put("checkouts", body.id, legacy);
    const answer = await handle(
      new Request(`${ORIGIN}/ucp/v1/checkout-sessions/${body.id}`, {
        headers: {
          "ucp-agent": ucpAgent(),
          "request-id": crypto.randomUUID(),
          "x-forwarded-for": randomIp(),
        },
      }),
    );
    expect(answer.status).toBe(404);
  });

  test("the buyer and saved cards show only to the checkout's own signed-in customer", async () => {
    const ada = await signUpCustomer();
    const bob = await signUpCustomer();
    const { body } = await call("POST", "/api/checkouts", {
      cookie: ada.cookie,
      body: checkoutBody,
    });
    const path = `/api/checkouts/${body.id}`;
    expect((await call("GET", path, { cookie: ada.cookie })).body.buyer.email).toBe(
      "ada@example.com",
    );
    expect((await call("GET", path, { cookie: bob.cookie })).body.buyer).toBeUndefined();
    expect((await call("GET", path)).body.buyer).toBeUndefined();

    const owner = await call("POST", `${path}/session`, { cookie: ada.cookie });
    expect(owner.body.storedCards).toBe(true);
    expect(fake.sessions.at(-1)!.shopperReference).toBe(customerFromCookies(ada.cookie)!.id);
    const stranger = await call("POST", `${path}/session`, { cookie: bob.cookie });
    expect(stranger.body.storedCards).toBe(false);
    expect(fake.sessions.at(-1)!.shopperReference).toBeUndefined();
  });

  test("a guest's checkout shows its buyer to the link holder and pays as a guest", async () => {
    const { body } = await call("POST", "/api/checkouts", { body: checkoutBody });
    expect((await call("GET", `/api/checkouts/${body.id}`)).body.buyer.email).toBe(
      "ada@example.com",
    );
    const session = await call("POST", `/api/checkouts/${body.id}/session`);
    expect(session.body.storedCards).toBe(false);
    expect(fake.sessions.at(-1)!.shopperReference).toBeUndefined();
  });

  test("a checkout handed over without an email takes one at its link, once", async () => {
    const { body } = await call("POST", "/api/checkouts", {
      body: { lines: checkoutBody.lines },
    });
    const path = `/api/checkouts/${body.id}`;
    const before = await call("GET", path);
    expect(before.body.status).toBe("incomplete");
    expect(before.body.messages.map((m: { code: string }) => m.code)).toEqual([
      "missing_buyer_email",
    ]);
    for (const email of ["", "   ", "not-an-email", 42])
      expect((await call("POST", `${path}/email`, { body: { email } })).status).toBe(400);
    const saved = await call("POST", `${path}/email`, { body: { email: " guest@example.com " } });
    expect(saved.status).toBe(200);
    expect(saved.body.status).not.toBe("incomplete");
    expect(saved.body.buyer.email).toBe("guest@example.com");
    const again = await call("POST", `${path}/email`, { body: { email: "other@example.com" } });
    expect(again.status).toBe(409);
    expect((await call("GET", path)).body.buyer.email).toBe("guest@example.com");
  });

  test("another account's checkout, or one with an email, cannot take one", async () => {
    const ada = await signUpCustomer();
    const bob = await signUpCustomer();
    const { body } = await call("POST", "/api/checkouts", {
      cookie: ada.cookie,
      body: { lines: checkoutBody.lines },
    });
    const path = `/api/checkouts/${body.id}/email`;
    const email = { email: "mallory@example.com" };
    expect((await call("POST", path, { cookie: bob.cookie, body: email })).status).toBe(404);
    expect((await call("POST", path, { body: email })).status).toBe(404);
    // Ada's own checkout has her account's email already.
    expect((await call("POST", path, { cookie: ada.cookie, body: email })).status).toBe(409);
  });

  test(`at most ${SESSIONS_PER_MINUTE} Drop-in or card-save sessions a minute per address`, async () => {
    const ip = randomIp();
    const { body } = await call("POST", "/api/checkouts", { body: checkoutBody });
    for (let i = 0; i < SESSIONS_PER_MINUTE; i++)
      expect((await call("POST", `/api/checkouts/${body.id}/session`, { ip })).status).toBe(200);
    const limited = await call("POST", `/api/checkouts/${body.id}/session`, { ip });
    expect([limited.status, limited.body.error]).toEqual([429, "rate_limited"]);
    const { cookie } = await signUpCustomer();
    expect((await call("POST", "/api/account/card-session", { cookie, ip })).status).toBe(429);
    expect((await call("POST", "/api/account/card-session", { cookie })).status).toBe(200);
  });

  test("the Back Office filters by channel", async () => {
    await call("POST", "/api/checkouts", { body: checkoutBody });
    await handle(
      new Request(`${ORIGIN}/ucp/v1/checkout-sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "ucp-agent": ucpAgent(),
          "request-id": crypto.randomUUID(),
          "idempotency-key": crypto.randomUUID(),
          "x-forwarded-for": randomIp(),
        },
        body: JSON.stringify({ line_items: [{ item: { id: SOCKS }, quantity: 1 }] }),
      }),
    );
    expect(
      backOfficeView()
        .checkouts.map((c) => c.channel)
        .sort(),
    ).toEqual(["agent", "web"]);
    expect(backOfficeView("web").checkouts.map((c) => c.channel)).toEqual(["web"]);
    expect(backOfficeView("agent").checkouts.map((c) => c.channel)).toEqual(["agent"]);
  });

  test("Adyen 3DS return bridge converts GET and cross-site POST to 303 same-origin GET and scopes refs", async () => {
    const getRes = await handle(
      new Request(`${ORIGIN}/api/return?to=/account&ref=cardsave_1&redirectResult=abc`),
    );
    expect(getRes.status).toBe(303);
    expect(getRes.headers.get("location")).toBe(
      `${ORIGIN}/account?redirectResult=abc&ref=cardsave_1`,
    );

    const postRes = await handle(
      new Request(`${ORIGIN}/api/return?to=/checkout/chk_123&ref=chk_123-s1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "cross-site",
        },
        body: "redirectResult=xyz",
      }),
    );
    expect(postRes.status).toBe(303);
    expect(postRes.headers.get("location")).toBe(
      `${ORIGIN}/checkout/chk_123?redirectResult=xyz&ref=chk_123-s1`,
    );

    for (const bad of ["https://evil.example", "//evil.example", "/sign-in", "/oauth/decision"]) {
      const denied = await handle(
        new Request(`${ORIGIN}/api/return?to=${encodeURIComponent(bad)}&redirectResult=x`),
      );
      expect(denied.status).toBe(400);
    }

    const { cookie } = await signUpCustomer("cardowner@example.com");
    const customer = customerFromCookies(cookie)!;
    const other = customerFromCookies((await signUpCustomer("other@example.com")).cookie)!;
    const cardSession = await call("POST", "/api/account/card-session", { cookie });
    expect(cardSession.status).toBe(200);
    const cardReturnUrl = new URL(fake.sessions.at(-1)!.returnUrl);
    expect(cardReturnUrl.pathname).toBe("/api/return");
    const cardRef = cardReturnUrl.searchParams.get("ref") ?? undefined;
    expect(sessionIdForReference(cardRef, { customerId: customer.id })).toBe(cardSession.body.id);
    expect(sessionIdForReference(cardRef, { customerId: other.id })).toBeUndefined();
    expect(sessionIdForReference("cardsave_missing", { customerId: customer.id })).toBeUndefined();

    const chk = await call("POST", "/api/checkouts", { body: checkoutBody });
    const chkSession = await call("POST", `/api/checkouts/${chk.body.id}/session`);
    const chkReturnUrl = new URL(fake.sessions.at(-1)!.returnUrl);
    expect(chkReturnUrl.pathname).toBe("/api/return");
    const chkRef = chkReturnUrl.searchParams.get("ref") ?? undefined;
    expect(sessionIdForReference(chkRef, { checkoutId: chk.body.id })).toBe(chkSession.body.id);
    expect(sessionIdForReference(chkRef, { checkoutId: "chk_other" })).toBeUndefined();
  });
});

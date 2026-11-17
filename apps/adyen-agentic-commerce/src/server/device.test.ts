// The device authorization grant (RFC 8628): only for clients that declare it, a user code the
// shopper types at /device, the same consent page, polling rules, and tokens once.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { agentState } from "../lib/agent-status";
import { accountView, handle } from "./api";
import { count, get, put } from "./db";
import {
  DEVICE_GRANT,
  DEVICE_REQUESTS_MAX,
  grants,
  pendingRequest,
  trackedMissAddresses,
  verifyUserCode,
} from "./oauth";
import { recentTrace } from "./trace";
import { freshStore, MCP, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { sha256 } from "./util";

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const CART = "dev.ucp.shopping.cart:manage";
const CHECKOUT = "dev.ucp.shopping.checkout:manage";

let tv: TestAgent; // a PAP client that declares the device grant
let web: TestAgent; // a PAP client that does not

beforeAll(async () => {
  tv = await TestAgent.start("Device agent", {
    grantTypes: ["authorization_code", "refresh_token", DEVICE_GRANT],
  });
  web = await TestAgent.start("Web agent");
});
afterAll(() => {
  tv.stop();
  web.stop();
});
beforeEach(() => {
  freshStore();
  tv.accessToken = "";
  tv.ip = randomIp();
});

const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
  handle(
    new Request(`${ORIGIN}${path}`, { method: "POST", body: new URLSearchParams(form), headers }),
  );

const answer = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Record<string, any>,
});

// The client authentication a PAP agent sends on every call to the authorization server.
const assertionOf = async (agent: TestAgent) => ({
  client_id: agent.clientId,
  client_assertion_type: ASSERTION_TYPE,
  client_assertion: await agent.assertion(),
});

async function start(agent: TestAgent, scope = `${CART} ${CHECKOUT}`) {
  return answer(
    await post("/oauth/device_authorization", { ...(await assertionOf(agent)), scope }),
  );
}

async function poll(agent: TestAgent, deviceCode: string) {
  return answer(
    await post("/oauth/token", {
      ...(await assertionOf(agent)),
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
    }),
  );
}

// The shopper's form on /device, from one address.
const verify = (userCode: string, address = randomIp()) =>
  post("/oauth/device/verify", { user_code: userCode }, { "x-forwarded-for": address });

async function consentFor(userCode: string) {
  const response = await verify(userCode);
  const location = new URL(response.headers.get("location") ?? `${ORIGIN}/`);
  if (!location.pathname.startsWith("/consent/")) throw new Error(`no consent: ${location.href}`);
  return location.pathname.split("/").pop()!;
}

// Moves a device request past its 600 s.
function expire(deviceCode: string) {
  const id = sha256(deviceCode);
  put("device_requests", id, {
    ...get<Record<string, unknown>>("device_requests", id)!,
    expiresAt: 1,
  });
}

describe("who may use it", () => {
  test("a public client can register for the device grant alone, without a callback", async () => {
    const { status, body } = await answer(
      await handle(
        new Request(`${ORIGIN}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_name: "Terminal agent", grant_types: [DEVICE_GRANT] }),
        }),
      ),
    );
    expect(status).toBe(201);
    expect(body.grant_types).toEqual([DEVICE_GRANT]);
    expect(body.redirect_uris).toEqual([]);
    expect(body.response_types).toEqual([]);
  });

  test("a client without a callback must not ask for the authorization code", async () => {
    const response = await handle(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Bad", grant_types: ["authorization_code"] }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_redirect_uri");
  });

  test("a client that did not declare the grant cannot start or poll a device sign-in", async () => {
    const started = await start(web);
    expect(started.status).toBe(400);
    expect(started.body.error).toBe("unauthorized_client");
    const polled = await poll(web, "anything");
    expect(polled.status).toBe(400);
    expect(polled.body.error).toBe("unauthorized_client");
  });

  test("a client identified by a URL that signs nothing cannot start a device sign-in", async () => {
    // Without a callback on its host, nothing would show the caller runs that URL.
    const open = await TestAgent.start("Public URL agent", {
      grantTypes: [DEVICE_GRANT],
      public: true,
    });
    try {
      const { status, body } = await answer(
        await post("/oauth/device_authorization", {
          client_id: open.clientId,
          scope: `${CART} ${CHECKOUT}`,
        }),
      );
      expect(status).toBe(400);
      expect(body.error).toBe("unauthorized_client");
    } finally {
      open.stop();
    }
  });

  test("starting device sign-ins shares the agents' rate limit", async () => {
    // protocol.ts allows 240 requests a minute per address.
    const headers = { "x-forwarded-for": randomIp() };
    const call = () => post("/oauth/device_authorization", { client_id: "unknown" }, headers);
    for (let i = 0; i < 240; i++) expect((await call()).status).not.toBe(429);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("an unknown scope is invalid_scope", async () => {
    const { status, body } = await start(tv, `${CART} admin`);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_scope");
  });

  test("a PAP client's device request without scope is invalid_scope (PAP 1.0 §4.7)", async () => {
    const missing = await answer(await post("/oauth/device_authorization", await assertionOf(tv)));
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_scope");
    expect((await start(tv, "   ")).body.error).toBe("invalid_scope");
  });

  test("a PAP client's poll without its client assertion is refused", async () => {
    const { body: started } = await start(tv);
    const { status, body } = await answer(
      await post("/oauth/token", {
        client_id: tv.clientId,
        grant_type: DEVICE_GRANT,
        device_code: started.device_code,
      }),
    );
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_client");
  });

  test("a device code answers only the client it was issued to", async () => {
    const other = await TestAgent.start("Other device agent", { grantTypes: [DEVICE_GRANT] });
    try {
      const { body: started } = await start(tv);
      const { status, body } = await poll(other, started.device_code);
      expect(status).toBe(400);
      expect(body.error).toBe("invalid_grant");
    } finally {
      other.stop();
    }
  });
});

describe("the codes", () => {
  test("the answer follows RFC 8628 §3.2 and keeps both codes out of the trace", async () => {
    const { status, body } = await start(tv);
    expect(status).toBe(200);
    expect(body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(body.verification_uri).toBe(`${ORIGIN}/device`);
    expect(body.verification_uri_complete).toBe(`${ORIGIN}/device?user_code=${body.user_code}`);
    expect(body.expires_in).toBe(600);
    expect(body.interval).toBe(5);
    expect(body.device_code.length).toBeGreaterThan(30);
    const traced = JSON.stringify(recentTrace(50));
    expect(traced).not.toContain(body.device_code);
    expect(traced).not.toContain(body.user_code);
    expect(traced).not.toContain(body.user_code.replace("-", ""));
  });

  test("polling before the shopper answers is pending; faster than the interval, slow_down", async () => {
    const { body: started } = await start(tv);
    const first = await poll(tv, started.device_code);
    expect(first.status).toBe(400);
    expect(first.body.error).toBe("authorization_pending");
    const second = await poll(tv, started.device_code);
    expect(second.body.error).toBe("slow_down");
    expect(second.body.error_description).toContain("10 s");
    const third = await poll(tv, started.device_code);
    expect(third.body.error).toBe("slow_down");
    expect(third.body.error_description).toContain("15 s");
  });

  test("a wrong code goes back to /device with the reason and nothing but letters", async () => {
    const response = await verify("<b>NOPE</b>-0000");
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${ORIGIN}/device`);
    expect(location.searchParams.get("error")).toBe("invalid_code");
    expect(location.searchParams.get("user_code")).toMatch(/^[A-Za-z-]*$/);
  });

  test("the code is read whatever its case and spacing, and opens a device consent", async () => {
    const { body: started } = await start(tv);
    const typed = started.user_code.toLowerCase().replace("-", " ");
    const requestId = await consentFor(typed);
    const request = pendingRequest(requestId)!;
    expect(request.device).toBe(sha256(started.device_code));
    expect(request.redirectUri).toBeUndefined();
    expect(request.scopes).toEqual([CART, CHECKOUT]);
    expect(request.clientName).toBe("Device agent");
  });

  test("an expired code is expired_token, and its user code no longer opens a consent", async () => {
    const { body: started } = await start(tv);
    expire(started.device_code);
    const { body } = await poll(tv, started.device_code);
    expect(body.error).toBe("expired_token");
    const location = (await verify(started.user_code)).headers.get("location")!;
    expect(new URL(location).searchParams.get("error")).toBe("invalid_code");
  });

  test("past ten wrong codes from one address, even the right code is refused there", async () => {
    const { body: started } = await start(tv);
    const address = randomIp();
    for (let i = 0; i < 10; i++) await verify("BBBB-BBBB", address);
    const blocked = new URL((await verify(started.user_code, address)).headers.get("location")!);
    expect(blocked.searchParams.get("error")).toBe("too_many_attempts");
    const elsewhere = new URL((await verify(started.user_code)).headers.get("location")!);
    expect(elsewhere.pathname.startsWith("/consent/")).toBe(true);
  });

  test("a forged first X-Forwarded-For entry does not spread wrong codes over addresses", async () => {
    const { body: started } = await start(tv);
    const address = randomIp();
    const guess = (code: string) =>
      post(
        "/oauth/device/verify",
        { user_code: code },
        { "cf-connecting-ip": address, "x-forwarded-for": `${randomIp()}, ${address}` },
      );
    for (let i = 0; i < 10; i++) await guess("BBBB-BBBB");
    const blocked = new URL((await guess(started.user_code)).headers.get("location")!);
    expect(blocked.searchParams.get("error")).toBe("too_many_attempts");
  });

  test("wrong codes sent in a victim's name count against the sender", async () => {
    const { body: started } = await start(tv);
    const victim = randomIp();
    const sender = randomIp();
    const forged = { "cf-connecting-ip": sender, "x-forwarded-for": `${victim}, ${sender}` };
    for (let i = 0; i < 10; i++)
      await post("/oauth/device/verify", { user_code: "BBBB-BBBB" }, forged);
    const own = await post(
      "/oauth/device/verify",
      { user_code: started.user_code },
      { "cf-connecting-ip": victim, "x-forwarded-for": victim },
    );
    expect(new URL(own.headers.get("location")!).pathname.startsWith("/consent/")).toBe(true);
  });

  test("only a wrong code leaves a record of its address", async () => {
    const { body: started } = await start(tv);
    await verify("BBBB-BBBB");
    const before = trackedMissAddresses();
    await verify(started.user_code);
    expect(trackedMissAddresses()).toBe(before);
    await verify("CCCC-CCCC");
    expect(trackedMissAddresses()).toBe(before + 1);
  });

  test("the record keeps at most a thousand addresses, however many are forged", () => {
    // Batches eleven minutes apart, ending over forty minutes ago: each stays under the total
    // limit, and none is recent enough to count against the tests that follow.
    const base = Date.now() - 2 * 60 * 60_000;
    try {
      for (let batch = 0; batch < 8; batch++) {
        setSystemTime(new Date(base + batch * 11 * 60_000));
        for (let i = 0; i < 150; i++) {
          expect(verifyUserCode("BBBB-BBBB", `forged-${batch}-${i}`)).toEqual({
            error: "invalid_code",
          });
        }
      }
      expect(trackedMissAddresses()).toBeLessThanOrEqual(1000);
    } finally {
      setSystemTime();
    }
  });

  test("the store holds a bounded number of device requests, whatever the addresses", async () => {
    const live = { status: "pending", userCode: "ZZZZZZZZ", expiresAt: Date.now() / 1000 + 600 };
    for (let i = 0; i < DEVICE_REQUESTS_MAX; i++) put("device_requests", `flood-${i}`, live);
    const refused = await start(tv);
    expect(refused.status).toBe(503);
    expect(refused.body.error).toBe("temporarily_unavailable");
    expect(count("device_requests")).toBe(DEVICE_REQUESTS_MAX);
  });

  test("a device request is forgotten one lifetime after it expires", async () => {
    try {
      // Started 21 minutes ago: past its 600 s, and past one lifetime more.
      setSystemTime(new Date(Date.now() - 21 * 60_000));
      const { body: old } = await start(tv);
      setSystemTime();
      const { body: fresh } = await start(tv);
      expect(get("device_requests", sha256(old.device_code))).toBeUndefined();
      expect(get("device_requests", sha256(fresh.device_code))).toBeDefined();
    } finally {
      setSystemTime();
    }
  });
});

describe("the shopper's answer", () => {
  test("approval, tokens once with the scopes ticked, an MCP call, then the code is used", async () => {
    const { body: started } = await start(tv);
    const requestId = await consentFor(started.user_code);
    const back = await tv.decide(requestId, { scopes: [CART, CHECKOUT, "ucp:pay"] });
    expect(back.href).toBe(`${ORIGIN}/device?done=approved`);
    // ucp:pay was ticked but never asked for: consent only narrows.
    const [grant] = grants();
    expect(grant!.scopes).toEqual([CART, CHECKOUT]);
    expect(grant!.tokenIssuedAt).toBeUndefined();

    const tokens = await poll(tv, started.device_code);
    expect(tokens.status).toBe(200);
    expect(tokens.body.token_type).toBe("Bearer");
    expect(tokens.body.scope).toBe(`${CART} ${CHECKOUT}`);
    expect(grants()[0]!.tokenIssuedAt).toBeDefined();
    expect(grants()[0]!.firstUsedAt).toBeUndefined();

    tv.accessToken = tokens.body.access_token;
    tv.delegation = await tv.makeDelegation();
    const listed = await tv.mcp("tools/list");
    expect(listed.status).toBe(200);
    expect(listed.body.result.tools.length).toBeGreaterThan(0);
    expect(grants()[0]!.firstUsedAt).toBeDefined();

    const again = await poll(tv, started.device_code);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
  });

  test("the shopper can narrow the scopes on the consent page", async () => {
    const { body: started } = await start(tv);
    await tv.decide(await consentFor(started.user_code), { scopes: [CART] });
    expect((await poll(tv, started.device_code)).body.scope).toBe(CART);
  });

  test("a declined code is access_denied", async () => {
    const { body: started } = await start(tv);
    const back = await tv.decide(await consentFor(started.user_code), { approve: false });
    expect(back.href).toBe(`${ORIGIN}/device?done=denied`);
    const { status, body } = await poll(tv, started.device_code);
    expect(status).toBe(400);
    expect(body.error).toBe("access_denied");
  });

  test("a code typed twice is decided once", async () => {
    const { body: started } = await start(tv);
    const first = await consentFor(started.user_code);
    const second = await consentFor(started.user_code);
    await tv.decide(first, { scopes: [CART, CHECKOUT] });
    const form = new URLSearchParams({
      request: second,
      decision: "approve",
      spend_limit_eur: "150",
    });
    form.append("scope", CART);
    const response = await handle(
      new Request(`${ORIGIN}/oauth/decision`, { method: "POST", body: form }),
    );
    expect(response.status).toBe(400);
    expect(grants()).toHaveLength(1);
  });

  test("a public client goes through the same steps and calls /mcp without a Poppy-Session", async () => {
    const registered = await answer(
      await handle(
        new Request(`${ORIGIN}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_name: "Terminal agent", grant_types: [DEVICE_GRANT] }),
        }),
      ),
    );
    const clientId = registered.body.client_id as string;
    const started = await answer(
      await post("/oauth/device_authorization", { client_id: clientId, scope: CHECKOUT }),
    );
    expect(started.status).toBe(200);
    const pollPublic = async () =>
      answer(
        await post("/oauth/token", {
          client_id: clientId,
          grant_type: DEVICE_GRANT,
          device_code: started.body.device_code,
        }),
      );
    expect((await pollPublic()).body.error).toBe("authorization_pending");
    await tv.decide(await consentFor(started.body.user_code), { scopes: [CHECKOUT] });
    const tokens = await pollPublic();
    expect(tokens.status).toBe(200);
    const response = await handle(
      new Request(MCP, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokens.body.access_token}`,
          "x-forwarded-for": randomIp(),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("the account", () => {
  test("shows consent, then access issued, then connected, in the consent page's words", async () => {
    const { body: started } = await start(tv);
    await tv.decide(await consentFor(started.user_code), { scopes: [CART, CHECKOUT] });
    const first = async () => (await accountView()).agents[0]!;
    expect(agentState(await first())).toBe("consented");
    const tokens = await poll(tv, started.device_code);
    expect(agentState(await first())).toBe("token_issued");
    tv.accessToken = tokens.body.access_token;
    tv.delegation = await tv.makeDelegation();
    await tv.mcp("tools/list");
    const connected = await first();
    expect(agentState(connected)).toBe("connected");
    expect(connected.permissions).toEqual([
      "Create, update and cancel carts for you",
      "Create, update and cancel checkouts for you, with your delivery details",
    ]);
    expect(JSON.stringify(connected)).not.toContain(tokens.body.access_token);
  });
});

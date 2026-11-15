// OAuth for agents: authorization code with PKCE S256, private_key_jwt client assertions,
// consent that can only narrow, single-use codes and rotating refresh tokens.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./api";
import { grants, updateGrant } from "./oauth";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";

const VERIFIER = "verifier-verifier-verifier-verifier-0123456789";
let agent: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("OAuth agent");
});
afterAll(() => agent.stop());
beforeEach(() => {
  freshStore();
  agent.ip = randomIp();
});

async function code(params: Record<string, string> = {}, decision: Parameters<TestAgent["decide"]>[1] = {}) {
  const { requestId } = await agent.authorize(params);
  if (!requestId) throw new Error("no consent request");
  const back = await agent.decide(requestId, decision);
  return back.searchParams.get("code")!;
}

const exchange = (c: string, extra: Record<string, string> = {}, assertion?: string) =>
  agent.token({ grant_type: "authorization_code", code: c, redirect_uri: agent.redirectUri, code_verifier: VERIFIER, ...extra }, assertion);

describe("authorize", () => {
  test("a valid request reaches the shopper's consent page", async () => {
    const { response, location, requestId } = await agent.authorize();
    expect(response.status).toBe(302);
    expect(location.pathname).toBe(`/consent/${requestId}`);
  });

  test("an unknown scope goes back to the client as invalid_scope, with state and iss", async () => {
    const { location } = await agent.authorize({ scope: "ucp:checkout admin" });
    expect(location.href.startsWith(agent.redirectUri)).toBe(true);
    expect(location.searchParams.get("error")).toBe("invalid_scope");
    expect(location.searchParams.get("state")).toBe("state-1");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });

  test("PKCE is required", async () => {
    const { location } = await agent.authorize({ code_challenge: "" });
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  test("PKCE plain is refused", async () => {
    const { location } = await agent.authorize({ code_challenge_method: "plain" });
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  test("an unregistered redirect_uri is refused here, never redirected to", async () => {
    const { response } = await agent.authorize({ redirect_uri: "http://127.0.0.1:1/elsewhere" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  test("a client id that is plain http off loopback is refused", async () => {
    const { response } = await agent.authorize({ client_id: "http://agent.example/client.json" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("invalid_client");
  });

  test("a shopper who declines sends access_denied", async () => {
    const { requestId } = await agent.authorize();
    const back = await agent.decide(requestId!, { approve: false });
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });

  test("a consent request is answered once", async () => {
    const { requestId } = await agent.authorize();
    await agent.decide(requestId!);
    const again = await handle(new Request(`${ORIGIN}/oauth/decision`, { method: "POST", body: new URLSearchParams({ request: requestId!, decision: "approve" }) }));
    expect(again.status).toBe(400);
  });
});

describe("consent", () => {
  test("the shopper can narrow the scopes", async () => {
    const { status, body } = await exchange(await code({}, { scopes: ["ucp:checkout"] }));
    expect(status).toBe(200);
    expect(body.scope).toBe("ucp:checkout");
  });

  test("the shopper cannot widen the scopes the agent asked for", async () => {
    const { body } = await exchange(await code({ scope: "ucp:checkout" }, { scopes: ["ucp:checkout", "ucp:pay"] }));
    expect(body.scope).toBe("ucp:checkout");
  });

  test("the spend limit is capped at 1000 EUR", async () => {
    await exchange(await code({}, { spendLimitEur: 50_000 }));
    expect(grants()[0]!.spendLimit).toBe(100_000);
  });
});

describe("token endpoint", () => {
  test("a code, the verifier and a signed assertion give tokens", async () => {
    const { status, body } = await exchange(await code());
    expect(status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token).toStartWith("at_");
    expect(body.refresh_token).toStartWith("rt_");
  });

  test("a wrong verifier fails and burns the code", async () => {
    const c = await code();
    expect((await exchange(c, { code_verifier: "wrong-wrong-wrong-wrong-wrong-wrong-wrong-0000" })).body.error).toBe("invalid_grant");
    expect((await exchange(c)).body.error).toBe("invalid_grant");
  });

  test("a code is single use", async () => {
    const c = await code();
    expect((await exchange(c)).status).toBe(200);
    const again = await exchange(c);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
  });

  test("the redirect_uri must match the one the code was issued for", async () => {
    expect((await exchange(await code(), { redirect_uri: `${agent.redirectUri}/other` })).body.error).toBe("invalid_grant");
  });

  test("a private_key_jwt client must send an assertion", async () => {
    const body = new URLSearchParams({ grant_type: "authorization_code", code: await code(), client_id: agent.clientId, redirect_uri: agent.redirectUri, code_verifier: VERIFIER });
    const response = await handle(new Request(`${ORIGIN}/oauth/token`, { method: "POST", body }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("invalid_client");
  });

  test("an assertion for another audience is refused", async () => {
    const { status, body } = await exchange(await code(), {}, await agent.assertion({ aud: "https://other.example" }));
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_client");
  });

  test("an assertion signed by a key the client did not publish is refused", async () => {
    const { status } = await exchange(await code(), {}, await agent.assertion({}, await TestAgent.foreignKeys()));
    expect(status).toBe(401);
  });

  test("an assertion living more than an hour is refused", async () => {
    const { status, body } = await exchange(await code(), {}, await agent.assertion({}, undefined, 3601));
    expect(status).toBe(401);
    expect(body.error_description).toContain("lifetime");
  });

  test("a replayed assertion is refused", async () => {
    const assertion = await agent.assertion();
    expect((await exchange(await code(), {}, assertion)).status).toBe(200);
    const again = await exchange(await code(), {}, assertion);
    expect(again.status).toBe(401);
    expect(again.body.error_description).toContain("replayed");
  });

  test("an unknown grant type is refused", async () => {
    expect((await agent.token({ grant_type: "client_credentials" })).body.error).toBe("unsupported_grant_type");
  });
});

describe("refresh", () => {
  test("a refresh rotates the refresh token", async () => {
    const first = (await exchange(await code())).body;
    const next = await agent.token({ grant_type: "refresh_token", refresh_token: first.refresh_token! });
    expect(next.status).toBe(200);
    expect(next.body.refresh_token).not.toBe(first.refresh_token);
    const reused = await agent.token({ grant_type: "refresh_token", refresh_token: first.refresh_token! });
    expect(reused.body.error).toBe("invalid_grant");
  });

  test("a refresh can narrow the scope but not widen it", async () => {
    const first = (await exchange(await code({}, { scopes: ["ucp:checkout", "ucp:orders"] }))).body;
    const wider = await agent.token({ grant_type: "refresh_token", refresh_token: first.refresh_token!, scope: "ucp:checkout ucp:pay" });
    expect(wider.body.error).toBe("invalid_scope");
    const narrower = await agent.token({ grant_type: "refresh_token", refresh_token: first.refresh_token!, scope: "ucp:orders" });
    expect(narrower.body.scope).toBe("ucp:orders");
  });

  test("revoking the agent's grant ends its tokens", async () => {
    await agent.signIn();
    updateGrant(grants()[0]!.id, { revoked: true });
    expect((await agent.mcp("ping")).status).toBe(401);
    expect((await agent.token({ grant_type: "refresh_token", refresh_token: agent.refreshToken })).body.error).toBe("invalid_grant");
  });

  test("a revoked access token stops working", async () => {
    await agent.signIn();
    const body = new URLSearchParams({ client_id: agent.clientId, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await agent.assertion(), token: agent.accessToken });
    expect((await handle(new Request(`${ORIGIN}/oauth/revoke`, { method: "POST", body }))).status).toBe(200);
    expect((await agent.mcp("ping")).status).toBe(401);
  });
});

describe("dynamic registration", () => {
  const register = (body: unknown) =>
    handle(new Request(`${ORIGIN}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  test("a generic MCP client registers as a public client", async () => {
    const response = await register({ client_name: "Desktop client", redirect_uris: ["http://127.0.0.1:33418/callback"] });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  test("plain http off loopback is refused", async () => {
    const response = await register({ client_name: "Bad", redirect_uris: ["http://agent.example/callback"] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_redirect_uri");
  });

  test("a registered client cannot claim private_key_jwt", async () => {
    const response = await register({ client_name: "Bad", redirect_uris: ["https://agent.example/cb"], token_endpoint_auth_method: "private_key_jwt" });
    expect(response.status).toBe(400);
  });
});

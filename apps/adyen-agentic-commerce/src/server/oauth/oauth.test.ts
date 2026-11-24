// OAuth for agents: authorization code with PKCE S256, private_key_jwt client assertions,
// consent that can only narrow, single-use codes and rotating refresh tokens.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SignJWT, UnsecuredJWT } from "jose";
import { handle } from "../api";
import { DEVICE_GRANT, grants, pendingRequest, updateGrant } from "./oauth";
import { freshStore, MCP, ORIGIN, randomIp, TestAgent } from "../testing/agent";
import { ucpAgent } from "../testing/platform";
import { recentTrace } from "../core/trace";
import { sha256b64url } from "../core/util";

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

async function code(
  params: Record<string, string> = {},
  decision: Parameters<TestAgent["decide"]>[1] = {},
) {
  const { requestId } = await agent.authorize(params);
  if (!requestId) throw new Error("no consent request");
  const back = await agent.decide(requestId, decision);
  return back.searchParams.get("code")!;
}

const exchange = (c: string, extra: Record<string, string> = {}, assertion?: string) =>
  agent.token(
    {
      grant_type: "authorization_code",
      code: c,
      redirect_uri: agent.redirectUri,
      code_verifier: VERIFIER,
      ...extra,
    },
    assertion,
  );

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
    const again = await handle(
      new Request(`${ORIGIN}/oauth/decision`, {
        method: "POST",
        headers: { cookie: agent.customerCookie },
        body: new URLSearchParams({ request: requestId!, decision: "approve" }),
      }),
    );
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
    const { body } = await exchange(
      await code({ scope: "ucp:checkout" }, { scopes: ["ucp:checkout", "ucp:pay"] }),
    );
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
    expect(
      (await exchange(c, { code_verifier: "wrong-wrong-wrong-wrong-wrong-wrong-wrong-0000" })).body
        .error,
    ).toBe("invalid_grant");
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
    expect(
      (await exchange(await code(), { redirect_uri: `${agent.redirectUri}/other` })).body.error,
    ).toBe("invalid_grant");
  });

  test("a private_key_jwt client must send an assertion", async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: await code(),
      client_id: agent.clientId,
      redirect_uri: agent.redirectUri,
      code_verifier: VERIFIER,
    });
    const response = await handle(new Request(`${ORIGIN}/oauth/token`, { method: "POST", body }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("invalid_client");
  });

  test("an assertion for another audience is refused", async () => {
    const { status, body } = await exchange(
      await code(),
      {},
      await agent.assertion({ aud: "https://other.example" }),
    );
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_client");
  });

  test("an assertion signed by a key the client did not publish is refused", async () => {
    const { status } = await exchange(
      await code(),
      {},
      await agent.assertion({}, await TestAgent.foreignKeys()),
    );
    expect(status).toBe(401);
  });

  test("an assertion living more than five minutes is refused", async () => {
    const { status, body } = await exchange(
      await code(),
      {},
      await agent.assertion({}, undefined, 301),
    );
    expect(status).toBe(401);
    expect(body.error_description).toContain("lifetime");
  });

  test("an assertion issued in the future is refused, beyond a minute of clock skew", async () => {
    const now = Math.floor(Date.now() / 1000);
    const later = await exchange(
      await code(),
      {},
      await agent.assertion({ iat: now + 86_400, exp: now + 86_400 + 300 }),
    );
    expect(later.status).toBe(401);
    expect(later.body.error_description).toContain("iat");
    const skewed = await agent.assertion({ iat: now + 30, exp: now + 30 + 300 });
    expect((await exchange(await code(), {}, skewed)).status).toBe(200);
  });

  test("an assertion living exactly five minutes is accepted", async () => {
    expect(
      (await exchange(await code(), {}, await agent.assertion({}, undefined, 300))).status,
    ).toBe(200);
  });

  test("an assertion without iat or jti is refused", async () => {
    for (const claim of ["iat", "jti"]) {
      const { status, body } = await exchange(
        await code(),
        {},
        await agent.assertion({}, undefined, 300, [claim]),
      );
      expect(status).toBe(401);
      expect(body.error_description).toContain(claim);
    }
  });

  test("a replayed assertion is refused", async () => {
    const assertion = await agent.assertion();
    expect((await exchange(await code(), {}, assertion)).status).toBe(200);
    const again = await exchange(await code(), {}, assertion);
    expect(again.status).toBe(401);
    expect(again.body.error_description).toContain("replayed");
  });

  test("an unknown grant type is refused", async () => {
    expect((await agent.token({ grant_type: "client_credentials" })).body.error).toBe(
      "unsupported_grant_type",
    );
  });
});

describe("refresh", () => {
  test("a refresh rotates the refresh token", async () => {
    const first = (await exchange(await code())).body;
    const next = await agent.token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token!,
    });
    expect(next.status).toBe(200);
    expect(next.body.refresh_token).not.toBe(first.refresh_token);
    const reused = await agent.token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token!,
    });
    expect(reused.body.error).toBe("invalid_grant");
  });

  test("a refresh can narrow the scope but not widen it, and the next refresh gets the rest back", async () => {
    const first = (await exchange(await code({}, { scopes: ["ucp:checkout", "ucp:orders"] }))).body;
    const wider = await agent.token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token!,
      scope: "ucp:checkout ucp:pay",
    });
    expect(wider.body.error).toBe("invalid_scope");
    const narrower = await agent.token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token!,
      scope: "ucp:orders",
    });
    expect(narrower.body.scope).toBe("ucp:orders");
    // RFC 6749 §6: the refresh token keeps the grant; only the access token was narrowed.
    const back = await agent.token({
      grant_type: "refresh_token",
      refresh_token: narrower.body.refresh_token!,
      scope: "ucp:checkout",
    });
    expect(back.body.scope).toBe("ucp:checkout");
    const plain = await agent.token({
      grant_type: "refresh_token",
      refresh_token: back.body.refresh_token!,
    });
    expect(plain.body.scope).toBe("ucp:checkout ucp:orders");
    const stillNarrow = await agent.token({
      grant_type: "refresh_token",
      refresh_token: plain.body.refresh_token!,
      scope: "ucp:checkout ucp:pay",
    });
    expect(stillNarrow.body.error).toBe("invalid_scope");
  });

  test("revoking the agent's grant ends its tokens", async () => {
    await agent.signIn();
    updateGrant(grants()[0]!.id, { revoked: true });
    expect((await agent.mcp("ping")).status).toBe(401);
    expect(
      (await agent.token({ grant_type: "refresh_token", refresh_token: agent.refreshToken })).body
        .error,
    ).toBe("invalid_grant");
  });

  const revoke = async (token: string, ip = agent.ip) => {
    const body = new URLSearchParams({
      client_id: agent.clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await agent.assertion(),
      token,
    });
    return handle(
      new Request(`${ORIGIN}/oauth/revoke`, {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body,
      }),
    );
  };

  test("a revoked access token stops working; the sign-in itself goes on", async () => {
    await agent.signIn();
    expect((await revoke(agent.accessToken)).status).toBe(200);
    expect((await agent.mcp("ping")).status).toBe(401);
    expect(grants()[0]!.revoked).toBe(false);
    const next = await agent.token({
      grant_type: "refresh_token",
      refresh_token: agent.refreshToken,
    });
    expect(next.status).toBe(200);
  });

  test("sign-out: revoking the live refresh token ends the grant and every token of that sign-in", async () => {
    await agent.signIn();
    expect((await agent.mcp("ping")).status).toBe(200);
    expect((await revoke(agent.refreshToken)).status).toBe(200);
    expect(grants()[0]!.revoked).toBe(true);
    expect((await agent.mcp("ping")).status).toBe(401);
  });

  test("revoking a refresh token a refresh already replaced signs nothing out", async () => {
    await agent.signIn();
    const old = agent.refreshToken;
    const next = await agent.token({ grant_type: "refresh_token", refresh_token: old });
    agent.accessToken = next.body.access_token!;
    expect((await revoke(old)).status).toBe(200);
    expect(grants()[0]!.revoked).toBe(false);
    expect((await agent.mcp("ping")).status).toBe(200);
  });

  test("the token and revocation endpoints share the agents' limit per address", async () => {
    const ip = randomIp();
    let status = 0;
    for (let i = 0; i < 241; i++) status = (await revoke("rt_unknown", ip)).status;
    expect(status).toBe(429);
    agent.ip = ip;
    const limited = await agent.token({ grant_type: "refresh_token", refresh_token: "rt_x" });
    expect([limited.status, limited.body.error]).toEqual([429, "rate_limited"]);
  });
});

describe("loopback redirects (RFC 8252 §7.3)", () => {
  test("a loopback redirect matches with any port, never another host or path", async () => {
    const withPort = (port: number) => agent.redirectUri.replace(/:(\d+)\//, `:${port}/`);
    const other = await agent.authorize({ redirect_uri: withPort(54321) });
    expect(other.requestId).toBeDefined();
    const back = await agent.decide(other.requestId!);
    expect(back.port).toBe("54321");
    const exchanged = await agent.token({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri: withPort(54321),
      code_verifier: VERIFIER,
    });
    expect(exchanged.status).toBe(200);
    for (const redirect_uri of [
      agent.redirectUri.replace("127.0.0.1", "localhost"),
      agent.redirectUri.replace("/callback", "/elsewhere"),
      `${agent.redirectUri}#x`,
    ]) {
      const refused = await agent.authorize({ redirect_uri });
      expect([redirect_uri, refused.response.status]).toEqual([redirect_uri, 400]);
    }
  });
});

describe("resource indicators", () => {
  // Whether a bearer token is accepted at /mcp and at UCP REST: 200, or 401 when it is not.
  async function worksAt(accessToken: string) {
    agent.accessToken = accessToken;
    agent.delegation = await agent.makeDelegation();
    const mcp = (await agent.mcp("ping")).status;
    const rest = (
      await handle(
        new Request(`${ORIGIN}/ucp/v1/catalog/search`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            "request-id": crypto.randomUUID(),
            "ucp-agent": ucpAgent(),
            "x-forwarded-for": randomIp(),
          },
          body: JSON.stringify({ query: "" }),
        }),
      )
    ).status;
    return { mcp, rest };
  }

  const refresh = (refreshToken: string, extra: Record<string, string> = {}) =>
    agent.token({ grant_type: "refresh_token", refresh_token: refreshToken, ...extra });

  test("a resource the store does not serve goes back as invalid_target, with state and iss", async () => {
    for (const resource of [
      "https://agent.example/mcp",
      `${ORIGIN}/ucp/v1`,
      `${MCP}/`,
      `${MCP}?x=1`,
      `${MCP}#x`,
      "mcp",
    ]) {
      const { location } = await agent.authorize({ resource });
      expect(location.searchParams.get("error")).toBe("invalid_target");
      expect(location.searchParams.get("state")).toBe("state-1");
      expect(location.searchParams.get("iss")).toBe(ORIGIN);
    }
  });

  test("the origin, with or without its slash, and the MCP URL reach consent", async () => {
    for (const resource of [ORIGIN, `${ORIGIN}/`, MCP])
      expect((await agent.authorize({ resource })).requestId).toBeDefined();
  });

  test("a token issued for the MCP URL works at /mcp only, one for the origin at REST only", async () => {
    const mcpOnly = (await exchange(await code({ resource: MCP }))).body;
    expect(await worksAt(mcpOnly.access_token!)).toEqual({ mcp: 200, rest: 401 });
    const restOnly = (await exchange(await code({ resource: `${ORIGIN}/` }))).body;
    expect(await worksAt(restOnly.access_token!)).toEqual({ mcp: 401, rest: 200 });
  });

  test("a token issued without a resource works at both", async () => {
    const both = (await exchange(await code())).body;
    expect(await worksAt(both.access_token!)).toEqual({ mcp: 200, rest: 200 });
  });

  test("the token request may name a granted resource, never another one", async () => {
    const narrowed = await exchange(await code(), { resource: MCP });
    expect(narrowed.status).toBe(200);
    expect(await worksAt(narrowed.body.access_token!)).toEqual({ mcp: 200, rest: 401 });
    const other = await exchange(await code({ resource: MCP }), { resource: ORIGIN });
    expect(other.status).toBe(400);
    expect(other.body.error).toBe("invalid_target");
    const unknown = await exchange(await code(), { resource: "https://agent.example/" });
    expect(unknown.body.error).toBe("invalid_target");
  });

  test("a token request may name several granted resources", async () => {
    const c = await code();
    const body = new URLSearchParams({
      client_id: agent.clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await agent.assertion(),
      grant_type: "authorization_code",
      code: c,
      redirect_uri: agent.redirectUri,
      code_verifier: VERIFIER,
    });
    body.append("resource", MCP);
    body.append("resource", ORIGIN);
    const response = await handle(new Request(`${ORIGIN}/oauth/token`, { method: "POST", body }));
    const tokens = (await response.json()) as Record<string, string>;
    expect(response.status).toBe(200);
    expect(await worksAt(tokens.access_token!)).toEqual({ mcp: 200, rest: 200 });
  });

  test("a refresh keeps the resource, may narrow to it and never widens it", async () => {
    const first = (await exchange(await code({ resource: MCP }))).body;
    const wider = await refresh(first.refresh_token!, { resource: ORIGIN });
    expect(wider.body.error).toBe("invalid_target");
    // A refused refresh does not spend the refresh token.
    const kept = await refresh(first.refresh_token!);
    expect(kept.status).toBe(200);
    expect(await worksAt(kept.body.access_token!)).toEqual({ mcp: 200, rest: 401 });
    const same = await refresh(kept.body.refresh_token!, { resource: MCP });
    expect(same.status).toBe(200);
    const all = (await exchange(await code())).body;
    const narrowed = await refresh(all.refresh_token!, { resource: ORIGIN });
    expect(await worksAt(narrowed.body.access_token!)).toEqual({ mcp: 401, rest: 200 });
  });

  // PAP 1.0 §4.5: a sign-in without resource covers every resource, at refresh too.
  test("narrowing one access token never narrows the next: the refresh token keeps the grant's resources", async () => {
    const exchanged = (await exchange(await code(), { resource: MCP })).body;
    expect(await worksAt(exchanged.access_token!)).toEqual({ mcp: 200, rest: 401 });
    const plain = await refresh(exchanged.refresh_token!);
    expect(await worksAt(plain.body.access_token!)).toEqual({ mcp: 200, rest: 200 });
    const narrowed = await refresh(plain.body.refresh_token!, { resource: MCP });
    const toOrigin = await refresh(narrowed.body.refresh_token!, { resource: ORIGIN });
    expect(toOrigin.status).toBe(200);
    expect(await worksAt(toOrigin.body.access_token!)).toEqual({ mcp: 401, rest: 200 });
  });
});

describe("dynamic registration", () => {
  const register = (body: unknown) =>
    handle(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  test("a generic MCP client registers as a public client", async () => {
    const response = await register({
      client_name: "Desktop client",
      redirect_uris: ["http://127.0.0.1:33418/callback"],
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  test("plain http off loopback is refused", async () => {
    const response = await register({
      client_name: "Bad",
      redirect_uris: ["http://agent.example/callback"],
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_redirect_uri");
  });

  test("a registered client that asks for no scope is offered the default set", async () => {
    // RFC 6749 §3.3 lets a server apply a default; PAP's scope rule binds only URL clients.
    const redirectUri = "http://127.0.0.1:33418/callback";
    const registered = await register({
      client_name: "Desktop client",
      redirect_uris: [redirectUri],
    });
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: (await registered.json()).client_id,
      redirect_uri: redirectUri,
      code_challenge: sha256b64url(VERIFIER),
      code_challenge_method: "S256",
    }).toString();
    const location = new URL((await handle(new Request(url))).headers.get("location")!, ORIGIN);
    expect(location.pathname.startsWith("/consent/")).toBe(true);
    expect(pendingRequest(location.pathname.split("/").pop()!)!.scopes).toEqual([
      "dev.ucp.shopping.cart:manage",
      "dev.ucp.shopping.checkout:manage",
      "ucp:pay",
    ]);
  });

  test("a public client identified by a URL that asks for no scope is offered the default set", async () => {
    // An MCP host with a client metadata document that signs nothing is not a PAP agent.
    const host = await TestAgent.start("URL host", { public: true });
    try {
      const { requestId } = await host.authorize({ scope: "" });
      expect(pendingRequest(requestId!)!.scopes).toEqual([
        "dev.ucp.shopping.cart:manage",
        "dev.ucp.shopping.checkout:manage",
        "ucp:pay",
      ]);
    } finally {
      host.stop();
    }
  });

  test("a registered client cannot claim private_key_jwt", async () => {
    const response = await register({
      client_name: "Bad",
      redirect_uris: ["https://agent.example/cb"],
      token_endpoint_auth_method: "private_key_jwt",
    });
    expect(response.status).toBe(400);
  });
});

// RFC 7523 leaves the assertion's algorithm to the server. An MCP client known by its client
// metadata document (ChatGPT's, 2026-11-18) signs with none of PAP's two, so any of six asymmetric
// algorithms is accepted on an assertion; a Session's delegation keeps PAP's ES256 or PS384.
describe("client assertion algorithms", () => {
  const SIX = ["ES256", "ES384", "PS256", "PS384", "RS256", "EdDSA"];

  test("the metadata lists the six asymmetric algorithms", async () => {
    const response = await handle(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    const metadata = (await response.json()) as Record<string, string[]>;
    expect([...metadata.token_endpoint_auth_signing_alg_values_supported!].sort()).toEqual(
      [...SIX].sort(),
    );
  });

  for (const alg of ["RS256", "PS256", "ES384", "EdDSA"]) {
    test(`a client whose key is ${alg} signs in, refreshes and calls /mcp with its token`, async () => {
      const client = await TestAgent.start(`${alg} client`, { alg });
      try {
        await client.signIn();
        const refreshed = await client.token({
          grant_type: "refresh_token",
          refresh_token: client.refreshToken,
        });
        expect([refreshed.status, refreshed.body.error]).toEqual([200, undefined]);
        client.accessToken = refreshed.body.access_token!;
        const listed = await client.mcp(
          "tools/list",
          {},
          { omitHeaders: ["poppy-version", "poppy-session"] },
        );
        expect(listed.status).toBe(200);
        expect(listed.body.result.tools.length).toBeGreaterThan(0);
      } finally {
        client.stop();
      }
    });
  }

  test("an assertion signed with an HMAC or not signed at all is invalid_client", async () => {
    const issued = Math.floor(Date.now() / 1000);
    const claims = {
      iss: agent.clientId,
      sub: agent.clientId,
      aud: ORIGIN,
      iat: issued,
      exp: issued + 60,
    };
    const hmac = await new SignJWT({ ...claims, jti: crypto.randomUUID() })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("a secret the store never holds, 32+"));
    const unsigned = new UnsecuredJWT({ ...claims, jti: crypto.randomUUID() }).encode();
    for (const assertion of [hmac, unsigned]) {
      const { status, body } = await exchange(await code(), {}, assertion);
      expect([status, body.error]).toEqual([401, "invalid_client"]);
    }
  });

  test("a client whose key is PS384 signs its assertion and its Session's delegation with it", async () => {
    const client = await TestAgent.start("PS384 client", { alg: "PS384" });
    try {
      await client.signIn();
      const { status, body } = await client.mcp("ping");
      expect([status, body.error]).toEqual([200, undefined]);
    } finally {
      client.stop();
    }
  });

  test("a Session whose delegation is signed RS256 is invalid_session", async () => {
    const client = await TestAgent.start("RS256 delegation", { alg: "RS256" });
    try {
      await client.signIn();
      const { status, body } = await client.mcp("ping");
      expect([status, body.error.data.code]).toEqual([400, "invalid_session"]);
      expect(body.error.data.content).toContain("delegation typ or alg");
    } finally {
      client.stop();
    }
  });
});

// PAP 1.0 §4.1 (draft-ietf-oauth-rfc7523bis) allows only the issuer. The owner chose on 2026-11-18
// (ADR-016) to accept the token endpoint too, as RFC 7523 §3 and OpenID Connect Core §9 do, because
// ChatGPT's MCP connector was refused without it. Arrays stay refused: rfc7523bis's main case.
describe("assertion audience", () => {
  test("the issuer, the issuer with a final slash and the token endpoint URL are accepted, and the trace names which", async () => {
    const forms: [string, string][] = [
      [ORIGIN, "issuer"],
      [`${ORIGIN}/`, "issuer with slash"],
      [`${ORIGIN}/oauth/token`, "token endpoint"],
    ];
    for (const [aud, name] of forms) {
      const { status, body } = await exchange(await code(), {}, await agent.assertion({ aud }));
      expect([aud, status, body.error_description]).toEqual([aud, 200, undefined]);
      const row = recentTrace().find((e) => e.path === "/oauth/token");
      expect([aud, row?.status, row?.detail]).toEqual([
        aud,
        200,
        expect.objectContaining({ audience: name }),
      ]);
    }
  });

  test("the device authorization endpoint takes the same audiences", async () => {
    const device = await TestAgent.start("Device audience", {
      grantTypes: ["authorization_code", "refresh_token", DEVICE_GRANT],
    });
    try {
      const start = async (aud: string | string[]) =>
        handle(
          new Request(`${ORIGIN}/oauth/device_authorization`, {
            method: "POST",
            headers: { "x-forwarded-for": device.ip },
            body: new URLSearchParams({
              client_id: device.clientId,
              client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
              client_assertion: await device.assertion({ aud }),
              scope: "dev.ucp.shopping.checkout:manage",
            }),
          }),
        );
      for (const aud of [ORIGIN, `${ORIGIN}/`, `${ORIGIN}/oauth/token`])
        expect([aud, (await start(aud)).status]).toEqual([aud, 200]);
      const refused = await start([ORIGIN]);
      expect(refused.status).toBe(401);
      expect(((await refused.json()) as { error: string }).error).toBe("invalid_client");
    } finally {
      device.stop();
    }
  });

  test("a revocation takes the token endpoint URL as aud and refuses an array", async () => {
    const { body } = await exchange(await code());
    const revoke = async (aud: string | string[]) =>
      handle(
        new Request(`${ORIGIN}/oauth/revoke`, {
          method: "POST",
          headers: { "x-forwarded-for": agent.ip },
          body: new URLSearchParams({
            client_id: agent.clientId,
            client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            client_assertion: await agent.assertion({ aud }),
            token: body.refresh_token!,
          }),
        }),
      );
    const refused = await revoke([`${ORIGIN}/oauth/token`]);
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { error: string }).error).toBe("invalid_client");
    expect((await revoke(`${ORIGIN}/oauth/token`)).status).toBe(200);
    const refreshed = await agent.token({
      grant_type: "refresh_token",
      refresh_token: body.refresh_token!,
    });
    expect(refreshed.body.error).toBe("invalid_grant");
  });

  test("an array, another endpoint or host, or no aud is invalid_client, naming what came", async () => {
    const cases: [string | string[], string][] = [
      [[ORIGIN], `[${ORIGIN}]`],
      [[ORIGIN, "https://other.example"], "https://other.example"],
      [`${ORIGIN}/oauth/revoke`, "/oauth/revoke"],
      [`${ORIGIN}/mcp`, "/mcp"],
      [`${ORIGIN}/oauth/token/`, "/oauth/token/"],
      [`${ORIGIN}//`, `${ORIGIN}//`],
      ["https://other.example", "https://other.example"],
      [ORIGIN.replace("http:", "https:"), ORIGIN.replace("http:", "https:")],
    ];
    for (const [aud, named] of cases) {
      const { status, body } = await exchange(await code(), {}, await agent.assertion({ aud }));
      expect([aud, status, body.error]).toEqual([aud, 401, "invalid_client"]);
      expect(body.error_description).toContain("aud");
      expect(body.error_description).toContain(named);
    }
    const missing = await exchange(
      await code(),
      {},
      await agent.assertion({}, undefined, 300, ["aud"]),
    );
    expect([missing.status, missing.body.error]).toEqual([401, "invalid_client"]);
    expect(missing.body.error_description).toContain("got no aud");
  });

  test("the refusal shows a hostile aud in printable ASCII, without quotes or backslashes, cut at 200", async () => {
    const hostile = `https://x.example/"\\\n\u0007é${"a".repeat(400)}`;
    const { status, body } = await exchange(
      await code(),
      {},
      await agent.assertion({ aud: hostile }),
    );
    expect(status).toBe(401);
    const shown = body.error_description!.slice(
      body.error_description!.indexOf("https://x.example/"),
    );
    expect(shown).toMatch(/^[\x20\x21\x23-\x5b\x5d-\x7e]+$/);
    expect(shown.length).toBeLessThanOrEqual(200);
    expect(shown).toStartWith("https://x.example/????");
  });
});

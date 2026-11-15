// The PAP 1.0 merchant-side MUST matrix: one test per rule the store enforces, through the same
// `handle` the route files serve. A rule missing here is a rule the store does not prove.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { exportJWK } from "jose";
import { handle } from "./api";
import { freshStore, MCP, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { sha256b64url } from "./util";

let agent: TestAgent;
let other: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("Conformance agent");
  other = await TestAgent.start("Other agent");
});
afterAll(() => {
  agent.stop();
  other.stop();
});
beforeEach(async () => {
  freshStore();
  agent.ip = randomIp();
  await agent.signIn();
});

const get = (path: string) => handle(new Request(`${ORIGIN}${path}`, { headers: { "x-forwarded-for": randomIp() } }));

describe("discovery", () => {
  test("poppy.json names the protocol version, the issuer and the MCP API, readable cross-origin", async () => {
    const response = await get("/.well-known/poppy.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const doc = await response.json();
    expect(doc.protocol_version).toBe("1.0");
    expect(doc.auth.issuer).toBe(ORIGIN);
    expect(doc.apis).toContainEqual(expect.objectContaining({ type: "mcp", url: MCP }));
    expect(doc.auth.scope_hints.changes).toContain("ucp:pay");
  });

  test("the protected resource metadata for /mcp points at this issuer", async () => {
    const doc = await (await get("/.well-known/oauth-protected-resource/mcp")).json();
    expect(doc.resource).toBe(MCP);
    expect(doc.authorization_servers).toEqual([ORIGIN]);
  });

  test("the authorization server accepts client metadata documents, private_key_jwt and S256 only", async () => {
    const doc = await (await get("/.well-known/oauth-authorization-server")).json();
    expect(doc.issuer).toBe(ORIGIN);
    expect(doc.client_id_metadata_document_supported).toBe(true);
    expect(doc.token_endpoint_auth_methods_supported).toContain("private_key_jwt");
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe("the resource", () => {
  test("an unsigned-in MCP call gets 401 with the resource metadata URL", async () => {
    const response = await handle(new Request(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });

  test("an unknown bearer token is invalid_token, with the error in WWW-Authenticate", async () => {
    const { status, headers, body } = await agent.mcp("ping", {}, { token: "at_forged" });
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
    expect(headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("a valid token and Poppy-Session reach the tools", async () => {
    const { status, body } = await agent.mcp("tools/list");
    expect(status).toBe(200);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("complete_checkout");
  });

  test("an unsupported Poppy-Version is version_unsupported", async () => {
    const { status, body } = await agent.mcp("ping", {}, { headers: { "poppy-version": "2.0" } });
    expect(status).toBe(400);
    expect(body.error).toBe("version_unsupported");
  });

  test("Poppy-Session is optional: a bearer token alone is accepted", async () => {
    const response = await handle(new Request(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${agent.accessToken}`, "x-forwarded-for": randomIp() },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));
    expect(response.status).toBe(200);
  });

  test("htu is compared without the query string", async () => {
    const response = await handle(new Request(`${MCP}?trace=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agent.accessToken}`,
        "poppy-version": "1.0",
        "poppy-session": await agent.session(MCP),
        "x-forwarded-for": randomIp(),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }));
    expect(response.status).toBe(200);
  });
});

describe("Poppy-Session refusals", () => {
  const refused = async (session: Parameters<TestAgent["mcp"]>[2], code = "invalid_session") => {
    const { status, body } = await agent.mcp("ping", {}, session);
    expect(status).toBe(400);
    expect(body.error).toBe(code);
    return body.error_description as string;
  };

  test("typ other than poppy-session+jwt", async () => {
    expect(await refused({ session: { header: { typ: "JWT" } } })).toContain("typ");
  });

  test("kid that is not the thumbprint of the delegated key", async () => {
    expect(await refused({ session: { header: { kid: "not-the-thumbprint" } } })).toContain("kid");
  });

  test("a signature by another key than cnf.jwk", async () => {
    const keys = await TestAgent.foreignKeys();
    expect(await refused({ session: { signer: keys } })).toContain("signature");
  });

  test("htu for another URL", async () => {
    expect(await refused({ session: { claims: { htu: `${ORIGIN}/ucp/v1/carts` } } })).toContain("htu");
  });

  test("htm for another method", async () => {
    expect(await refused({ session: { claims: { htm: "GET" } } })).toContain("htm");
  });

  test("aud for another resource", async () => {
    expect(await refused({ session: { claims: { aud: "https://shop.example" } } })).toContain("aud");
  });

  test("an iat outside five minutes", async () => {
    const stale = Math.floor(Date.now() / 1000) - 301;
    expect(await refused({ session: { claims: { iat: stale } } })).toContain("iat");
  });

  test("a replayed jti", async () => {
    const jti = crypto.randomUUID();
    expect((await agent.mcp("ping", {}, { session: { claims: { jti } } })).status).toBe(200);
    expect(await refused({ session: { claims: { jti } } })).toContain("jti");
  });

  test("sid or sub missing", async () => {
    expect(await refused({ session: { omit: ["sid"] } })).toContain("sid");
  });

  test("ath missing while a token is sent", async () => {
    expect(await refused({ session: { omit: ["ath"] } })).toContain("ath");
  });

  test("ath for another token", async () => {
    expect(await refused({ session: { claims: { ath: sha256b64url("at_other") } } })).toContain("ath");
  });

  test("ath without any token", async () => {
    expect(await refused({ token: null })).toContain("ath");
  });

  test("a session from another client presented with this client's token", async () => {
    other.ip = randomIp();
    await other.signIn();
    const { status, body } = await other.mcp("ping", {}, {
      token: agent.accessToken,
      session: { claims: { ath: sha256b64url(agent.accessToken) } },
    });
    expect(status).toBe(400);
    expect(body.error_description).toContain("another client");
  });

  test("poppy_dlg missing", async () => {
    expect(await refused({ session: { omit: ["poppy_dlg"] } })).toContain("poppy_dlg");
  });

  test("a delegation with the wrong typ", async () => {
    const delegation = await agent.makeDelegation({ typ: "JWT" });
    expect(await refused({ session: { delegation } })).toContain("delegation typ");
  });

  test("a delegation not signed by a key from the client's jwks_uri", async () => {
    const delegation = await agent.makeDelegation({ signer: await TestAgent.foreignKeys() });
    expect(await refused({ session: { delegation } })).toContain("client's keys");
  });

  test("a delegation for another session key", async () => {
    const stranger = await TestAgent.foreignKeys();
    const delegation = await agent.makeDelegation({ cnf: await exportJWK(stranger.publicKey) });
    expect(await refused({ session: { delegation } })).toContain("kid");
  });

  test("a delegation lasting more than 24 hours", async () => {
    const delegation = await agent.makeDelegation({ lifetime: 24 * 3600 + 1 });
    expect(await refused({ session: { delegation } })).toContain("24 hours");
  });

  test("an expired delegation ends the session", async () => {
    const delegation = await agent.makeDelegation({ iat: Math.floor(Date.now() / 1000) - 7200, lifetime: 3600 });
    await refused({ session: { delegation } }, "session_ended");
  });
});

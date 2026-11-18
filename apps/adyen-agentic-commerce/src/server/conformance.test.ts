// The PAP 1.0 merchant-side MUST matrix: one test per rule the store enforces, through the same
// `handle` the route files serve. A rule missing here is a rule the store does not prove.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { exportJWK } from "jose";
import { handle } from "./api";
import { recentTrace } from "./trace";
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

const get = (path: string) =>
  handle(new Request(`${ORIGIN}${path}`, { headers: { "x-forwarded-for": randomIp() } }));

describe("discovery", () => {
  test("poppy.json names the protocol version, the issuer and the MCP API, readable cross-origin", async () => {
    const response = await get("/.well-known/poppy.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const doc = await response.json();
    expect(doc.protocol_version).toBe("1.0");
    expect(doc.auth.issuer).toBe(ORIGIN);
    expect(doc.apis).toContainEqual(expect.objectContaining({ type: "mcp", url: MCP }));
  });

  test("poppy.json describes and hints every offered scope, keyed by scope name (§3.1, §4.7)", async () => {
    const doc = await (await get("/.well-known/poppy.json")).json();
    const metadata = await (await get("/.well-known/oauth-authorization-server")).json();
    const described = Object.keys(doc.auth.scopes).sort();
    expect(described).toEqual([...metadata.scopes_supported].sort());
    expect(Object.keys(doc.auth.scope_hints).sort()).toEqual(described);
    for (const scope of described) {
      expect(typeof doc.auth.scopes[scope]).toBe("string");
      // A Company MUST include both fields in each entry.
      expect(Object.keys(doc.auth.scope_hints[scope]).sort()).toEqual(["changes", "personal_data"]);
      expect(["none", "reversible", "irreversible"]).toContain(doc.auth.scope_hints[scope].changes);
      expect(typeof doc.auth.scope_hints[scope].personal_data).toBe("boolean");
    }
    expect(doc.auth.scope_hints["ucp:pay"]).toEqual({
      changes: "irreversible",
      personal_data: true,
    });
    expect(doc.auth.scope_hints["dev.ucp.shopping.order:read"]).toEqual({
      changes: "none",
      personal_data: true,
    });
    // §4.7: a description says whether the task works without the scope.
    expect(doc.auth.scopes["ucp:pay"]).toContain("network token");
    expect(doc.auth.scopes["dev.ucp.shopping.cart:manage"]).toContain("guest");
    const mcp = doc.apis.find((a: { type: string }) => a.type === "mcp");
    expect(mcp.description).toContain("network token");
    expect(mcp.description).toContain("continue_url");
    // Legacy names are honoured at sign-in, never offered.
    expect(doc.auth.scopes["ucp:checkout"]).toBeUndefined();
    expect(doc.auth.scopes["ucp:orders"]).toBeUndefined();
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
    const response = await handle(
      new Request(MCP, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  test("an unknown bearer token is invalid_token in WWW-Authenticate, identity_required in the body", async () => {
    const { status, headers, body } = await agent.mcp("ping", {}, { token: "at_forged" });
    expect(status).toBe(401);
    expect(body.error.code).toBe(-32000);
    expect(body.error.data.code).toBe("identity_required");
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

  test("a Session without Poppy-Version is version_unsupported (§3.4)", async () => {
    const { status, body } = await agent.mcp("ping", {}, { omitHeaders: ["poppy-version"] });
    expect(status).toBe(400);
    expect(body.error).toBe("version_unsupported");
  });

  test("a later 1.x minor version is compatible with 1.0", async () => {
    expect((await agent.mcp("ping", {}, { headers: { "poppy-version": "1.1" } })).status).toBe(200);
  });

  test("a Poppy-Version that is not major.minor is version_unsupported", async () => {
    for (const version of ["1", "1.0.0", "01.0", "1.x"]) {
      const { status, body } = await agent.mcp(
        "ping",
        {},
        { headers: { "poppy-version": version } },
      );
      expect(status).toBe(400);
      expect(body.error).toBe("version_unsupported");
    }
  });

  test("a bearer token without a Session needs no Poppy-Version", async () => {
    const { status } = await agent.mcp(
      "ping",
      {},
      { omitHeaders: ["poppy-version", "poppy-session"] },
    );
    expect(status).toBe(200);
  });

  test("Poppy-Session is optional: a bearer token alone is accepted", async () => {
    const response = await handle(
      new Request(MCP, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agent.accessToken}`,
          "x-forwarded-for": randomIp(),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    expect(response.status).toBe(200);
  });

  test("htu is compared without the query string", async () => {
    const response = await handle(
      new Request(`${MCP}?trace=1`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agent.accessToken}`,
          "poppy-version": "1.0",
          "poppy-session": await agent.session(MCP),
          "x-forwarded-for": randomIp(),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("Poppy-Session refusals", () => {
  // PAP's UCP extension §9: on MCP, invalid_session is a JSON-RPC error -32000 naming the code.
  const refused = async (session: Parameters<TestAgent["mcp"]>[2], code = "invalid_session") => {
    const { status, body } = await agent.mcp("ping", {}, session);
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32000);
    expect(body.error.data.code).toBe(code);
    return body.error.data.content as string;
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
    expect(await refused({ session: { claims: { htu: `${ORIGIN}/ucp/v1/carts` } } })).toContain(
      "htu",
    );
  });

  test("htm for another method", async () => {
    expect(await refused({ session: { claims: { htm: "GET" } } })).toContain("htm");
  });

  test("aud for another Company", async () => {
    expect(await refused({ session: { claims: { aud: "https://shop.example" } } })).toContain(
      "aud",
    );
  });

  test("aud is the issuer itself, not the MCP URL (§5.2)", async () => {
    expect(await refused({ session: { claims: { aud: MCP } } })).toContain("aud");
  });

  test("aud is a single string, not an array holding the issuer (§10.4)", async () => {
    expect(await refused({ session: { claims: { aud: [ORIGIN] } } })).toContain("aud");
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

  test("a jti is remembered as long as its iat could still pass, an iat ahead of the clock included", async () => {
    const t0 = Date.now();
    const jti = crypto.randomUUID();
    const iat = Math.floor(t0 / 1000) + 250;
    const jwt = await agent.session(MCP, "POST", { claims: { iat, jti } });
    expect((await agent.mcp("ping", {}, { headers: { "poppy-session": jwt } })).status).toBe(200);
    // 320 s later the iat is still within five minutes, so the jti must still be known.
    setSystemTime(new Date(t0 + 320_000));
    try {
      const replay = await agent.mcp("ping", {}, { headers: { "poppy-session": jwt } });
      expect(replay.status).toBe(400);
      expect(replay.body.error.data.content).toContain("jti");
    } finally {
      setSystemTime();
    }
  });

  test("sid or sub missing", async () => {
    expect(await refused({ session: { omit: ["sid"] } })).toContain("sid");
  });

  test("ath missing while a token is sent", async () => {
    expect(await refused({ session: { omit: ["ath"] } })).toContain("ath");
  });

  test("ath for another token", async () => {
    expect(await refused({ session: { claims: { ath: sha256b64url("at_other") } } })).toContain(
      "ath",
    );
  });

  test("ath without any token", async () => {
    expect(await refused({ token: null })).toContain("ath");
  });

  test("a session from another client presented with this client's token", async () => {
    other.ip = randomIp();
    await other.signIn();
    const { status, body } = await other.mcp(
      "ping",
      {},
      {
        token: agent.accessToken,
        session: { claims: { ath: sha256b64url(agent.accessToken) } },
      },
    );
    expect(status).toBe(400);
    expect(body.error.data.content).toContain("another client");
  });

  test("poppy_dlg missing", async () => {
    expect(await refused({ session: { omit: ["poppy_dlg"] } })).toContain("poppy_dlg");
  });

  test("poppy_dlg in the claims instead of the JWT header (§5.2)", async () => {
    const error = await refused({
      session: { omit: ["poppy_dlg"], claims: { poppy_dlg: agent.delegation } },
    });
    expect(error).toContain("poppy_dlg");
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

  // §5.2: a delegation that fails any check, expiry included, is invalid_session.
  test("an expired delegation", async () => {
    const delegation = await agent.makeDelegation({
      iat: Math.floor(Date.now() / 1000) - 7200,
      lifetime: 3600,
    });
    expect(await refused({ session: { delegation } })).toContain("expired");
  });
});

// Every outbound URL the store fetched while `run` ran.
async function fetchesDuring(run: () => Promise<unknown>): Promise<string[]> {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return original(input, init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return urls;
}

// A client assertion with no valid signature, naming `clientId`.
function unsignedAssertion(clientId: string) {
  const part = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "ES256" })}.${part({ iss: clientId, sub: clientId, aud: ORIGIN })}.c2ln`;
}

const tokenRequest = (assertion: string) =>
  handle(
    new Request(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "x-forwarded-for": randomIp() },
      body: new URLSearchParams({
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: assertion,
        grant_type: "refresh_token",
        refresh_token: "rt_x",
      }),
    }),
  );

describe("outbound fetches (§3)", () => {
  test("a client_id on a private address is invalid_client, and nothing is fetched", async () => {
    for (const clientId of ["https://10.0.0.1/agent.json", "https://[fd00::1]/agent.json"]) {
      let response: Response | undefined;
      const urls = await fetchesDuring(async () => {
        response = await tokenRequest(unsignedAssertion(clientId));
      });
      expect(response!.status).toBe(401);
      expect(((await response!.json()) as { error: string }).error).toBe("invalid_client");
      expect(urls).toEqual([]);
    }
  });

  test("a client document that cannot be fetched is invalid_client, not a server error", async () => {
    const response = await tokenRequest(unsignedAssertion("https://127.0.0.1:9/agent.json"));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_client");
  });

  test("the client's keys are cached: signed requests fetch nothing", async () => {
    const urls = await fetchesDuring(async () => {
      for (let i = 0; i < 3; i++) expect((await agent.mcp("ping")).status).toBe(200);
      expect(
        (await agent.token({ grant_type: "refresh_token", refresh_token: agent.refreshToken }))
          .status,
      ).toBe(200);
    });
    expect(urls).toEqual([]);
  });

  test("an unknown key id refetches the keys at most once a minute, so a rotation is picked up", async () => {
    const t0 = Date.now();
    await agent.rotateClientKey();
    try {
      // Fetched at sign-in a moment ago: the new key is not looked for yet.
      agent.delegation = await agent.makeDelegation();
      expect((await agent.mcp("ping")).status).toBe(400);
      setSystemTime(new Date(t0 + 61_000));
      agent.delegation = await agent.makeDelegation();
      const urls = await fetchesDuring(async () => {
        expect((await agent.mcp("ping")).status).toBe(200);
        const stranger = await agent.makeDelegation({ signer: await TestAgent.foreignKeys() });
        expect((await agent.mcp("ping", {}, { session: { delegation: stranger } })).status).toBe(
          400,
        );
      });
      expect(urls.filter((u) => u.endsWith("/jwks.json"))).toHaveLength(1);
    } finally {
      setSystemTime();
    }
  });
});

describe("sign-in", () => {
  test("a sign-in request without scope goes back as invalid_scope (§4.7)", async () => {
    // "" leaves the parameter out entirely; "   " sends it blank.
    for (const scope of ["", "   "]) {
      const { location } = await agent.authorize({ scope });
      expect(location.href.startsWith(agent.redirectUri)).toBe(true);
      expect(location.searchParams.get("error")).toBe("invalid_scope");
      expect(location.searchParams.get("state")).toBe("state-1");
    }
  });
});

describe("task coverage (§9)", () => {
  const TASKS = `${ORIGIN}/poppy/tasks`;
  const FEEDBACK = `${ORIGIN}/poppy/feedback`;
  // Task coverage describes the store, not an account: the Session carries no ath.
  const papHeaders = async (url: string, method: string) => ({
    "poppy-version": "1.0",
    "poppy-session": await agent.session(url, method, { omit: ["ath"] }),
    "x-forwarded-for": randomIp(),
  });
  const feedback = async (body: unknown, headers?: Record<string, string>) =>
    handle(
      new Request(FEEDBACK, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(headers ?? (await papHeaders(FEEDBACK, "POST"))),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const lastPapTrace = () => recentTrace(20).find((row) => row.channel === "pap");

  test("poppy.json names tasks.endpoint, and a Session gets the excluded tasks and the feedback endpoint", async () => {
    const doc = await (await get("/.well-known/poppy.json")).json();
    expect(doc.tasks).toEqual({ endpoint: TASKS });
    const response = await handle(new Request(TASKS, { headers: await papHeaders(TASKS, "GET") }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const tasks = await response.json();
    expect(tasks.feedback).toEqual({ endpoint: FEEDBACK });
    expect(tasks.excluded_tasks.length).toBeGreaterThan(0);
    const tools = (await agent.mcp("tools/list")).body.result.tools.map(
      (t: { name: string }) => t.name,
    );
    const openapi = await (await get("/ucp/v1/openapi.json")).json();
    const operations = Object.values<Record<string, { operationId: string }>>(
      openapi.paths,
    ).flatMap((path) => Object.values(path).map((op) => op.operationId));
    const apis = new Map(doc.apis.map((a: { type: string; url: string }) => [a.url, a.type]));
    for (const { task, alternative } of tasks.excluded_tasks) {
      expect(task.length).toBeGreaterThan(0);
      if (!alternative) continue;
      // §9.2: at least one of instructions or references.
      expect(Boolean(alternative.instructions || alternative.references?.length)).toBe(true);
      for (const ref of alternative.references ?? []) {
        // An openapi or mcp reference MUST name an API listed in poppy.json, and what it names exists.
        if (ref.type === "mcp")
          expect([apis.get(ref.url), tools.includes(ref.tool)]).toEqual(["mcp", true]);
        if (ref.type === "openapi")
          expect([apis.get(ref.url), operations.includes(ref.operation_id)]).toEqual([
            "openapi",
            true,
          ]);
        if (ref.type === "web") expect(ref.url).toStartWith(`${ORIGIN}/`);
      }
    }
  });

  test("the tasks request checks the Session like the APIs, with PAP's JSON errors", async () => {
    const wrong = await handle(
      new Request(TASKS, { headers: await papHeaders(`${ORIGIN}/poppy/other`, "GET") }),
    );
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_session");
    const version = await handle(
      new Request(TASKS, { headers: { "poppy-version": "2.0", "x-forwarded-for": randomIp() } }),
    );
    expect(((await version.json()) as { error: string }).error).toBe("version_unsupported");
    // Without a Session the same document is served: it describes the store, not a User.
    expect(
      (await handle(new Request(TASKS, { headers: { "x-forwarded-for": randomIp() } }))).status,
    ).toBe(200);
  });

  test("feedback is 202 with no body, attributed to the client only after the Session is verified", async () => {
    const report = {
      task: "Pay with a gift card",
      description: "The checkout has no gift card field.",
    };
    const verified = await feedback(report);
    expect(verified.status).toBe(202);
    expect(await verified.text()).toBe("");
    expect(lastPapTrace()).toEqual(
      expect.objectContaining({ actor: "Conformance agent", status: 202 }),
    );
    expect(lastPapTrace()!.detail).toEqual(
      expect.objectContaining({ feedback: report, client: agent.clientId }),
    );
    const anonymous = await feedback(report, { "x-forwarded-for": randomIp() });
    expect(anonymous.status).toBe(202);
    expect(lastPapTrace()).toEqual(expect.objectContaining({ actor: "unverified agent" }));
    const forged = await feedback(report, await papHeaders(TASKS, "POST"));
    expect(forged.status).toBe(400);
    expect(((await forged.json()) as { error: string }).error).toBe("invalid_session");
  });

  test("a malformed or too long report is invalid_request", async () => {
    for (const body of [
      "not json",
      [],
      { task: "Return a jacket" },
      { description: "No returns anywhere." },
      { task: "", description: "x" },
      { task: 7, description: "x" },
      { task: "x".repeat(201), description: "x" },
      { task: "x", description: "x".repeat(2001) },
    ]) {
      const response = await feedback(body);
      expect([JSON.stringify(body).slice(0, 40), response.status]).toEqual([
        JSON.stringify(body).slice(0, 40),
        400,
      ]);
      expect(((await response.json()) as { error: string }).error).toBe("invalid_request");
    }
    expect((await feedback({ task: "x".repeat(200), description: "x".repeat(2000) })).status).toBe(
      202,
    );
  });
});

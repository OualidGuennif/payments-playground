// UCP 2026-08-25 negotiation on the business side: the profile URL rules, the fetch guards, the
// platform profile check, the version check, the capability intersection, and where it runs.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./api";
import { cachedProfile } from "./profile";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { fetchesOf, PLATFORM, PROFILE, ucpAgent } from "./testing/platform";
import { OP_CAPABILITY, OPERATIONS, STORE_CAPABILITIES } from "./ucp";

let agent: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("Negotiating agent");
});
afterAll(() => agent.stop());
beforeEach(() => {
  freshStore();
  agent.ip = randomIp();
});

async function rest(
  method: string,
  path: string,
  opts: { body?: unknown; agentHeader?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "request-id": crypto.randomUUID(),
    "x-forwarded-for": randomIp(),
    ...opts.headers,
  };
  if (opts.agentHeader !== null) headers["ucp-agent"] = opts.agentHeader ?? ucpAgent();
  const response = await handle(
    new Request(`${ORIGIN}/ucp/v1${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const search = (agentHeader?: string | null, headers?: Record<string, string>) =>
  rest("POST", "/catalog/search", { body: { query: "" }, agentHeader, headers });
const createCart = (agentHeader?: string | null, key = crypto.randomUUID()) =>
  rest("POST", "/carts", {
    body: { line_items: [{ item: { id: "velune-rib-socks-oat-one-size" }, quantity: 1 }] },
    agentHeader,
    headers: { "idempotency-key": key },
  });

const code = (body: Record<string, any>) => body.messages?.[0]?.code;

describe("the profile URL", () => {
  test("a missing or unparsable UCP-Agent is invalid_profile_url 400", async () => {
    for (const header of [null, 'foo="bar"', `profile=${PROFILE}`, "profile=", 'profile=""']) {
      const { status, body } = await search(header);
      expect(status).toBe(400);
      expect(code(body)).toBe("invalid_profile_url");
      expect(body.ucp.status).toBe("error");
      expect(body.continue_url).toBe(`${ORIGIN}/shop`);
    }
  });

  test("other dictionary members around profile are fine", async () => {
    expect((await search(`v=1, profile="${PROFILE}";x=2, z`)).status).toBe(200);
  });

  test("plain http off loopback, an IP literal, credentials or a long URL are refused", async () => {
    for (const url of [
      "http://agent.example/profile.json",
      "https://10.0.0.1/profile.json",
      "https://[2001:db8::1]/profile.json",
      "https://user:pass@agent.example/profile.json",
      `https://agent.example/${"a".repeat(2050)}`,
      "not a url",
    ]) {
      const { status, body } = await search(ucpAgent(url));
      expect(status).toBe(400);
      expect(code(body)).toBe("invalid_profile_url");
    }
  });
});

describe("fetching the profile", () => {
  test("a redirect or an error status is profile_unreachable 424", async () => {
    const target = fetchesOf("/profile.json");
    for (const path of ["/redirect.json", "/missing.json"]) {
      const { status, body } = await search(ucpAgent(`${PLATFORM}${path}`));
      expect(status).toBe(424);
      expect(code(body)).toBe("profile_unreachable");
    }
    // The redirect was not followed to its target.
    expect(fetchesOf("/profile.json")).toBe(target);
  });

  test("a host that does not answer is profile_unreachable", async () => {
    const { status, body } = await search(ucpAgent("http://127.0.0.1:9/profile.json"));
    expect(status).toBe(424);
    expect(code(body)).toBe("profile_unreachable");
  });

  test("not JSON, not a platform profile, a private key or over 256 KiB is profile_malformed 422", async () => {
    for (const path of [
      "/not-json.json",
      "/no-services.json",
      "/bad-version.json",
      "/private-key.json",
      "/huge.json",
    ]) {
      const { status, body } = await search(ucpAgent(`${PLATFORM}${path}`));
      expect(status).toBe(422);
      expect(code(body)).toBe("profile_malformed");
    }
  });

  test("a profile is cached for its max-age; a no-store one is fetched every time", async () => {
    const cached = fetchesOf("/profile.json");
    await search();
    await search();
    expect(fetchesOf("/profile.json") - cached).toBe(1);
    const uncached = fetchesOf("/uncached.json");
    await search(ucpAgent(`${PLATFORM}/uncached.json`));
    await search(ucpAgent(`${PLATFORM}/uncached.json`));
    expect(fetchesOf("/uncached.json") - uncached).toBe(2);
  });

  test("a cached profile keeps only what negotiation needs, however large it was", async () => {
    const url = `${PLATFORM}/padded.json`;
    const served = await (await fetch(url)).text();
    expect(served.length).toBeGreaterThan(200 * 1024);
    expect(served.length).toBeLessThan(256 * 1024);
    expect((await search(ucpAgent(url))).status).toBe(200);
    const entry = cachedProfile(url, STORE_CAPABILITIES);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry).length).toBeLessThan(1024);
  });

  test("the rate limit and the token come first: a refused token fetches nothing", async () => {
    const before = fetchesOf("/uncached.json");
    const { status } = await search(ucpAgent(`${PLATFORM}/uncached.json`), {
      authorization: "Bearer at_forged",
    });
    expect(status).toBe(401);
    expect(fetchesOf("/uncached.json")).toBe(before);
  });
});

describe("negotiation", () => {
  test("every operation belongs to one of the store's capabilities", () => {
    for (const op of Object.keys(OPERATIONS))
      expect(STORE_CAPABILITIES).toContain(OP_CAPABILITY[op]!);
  });

  test("another protocol version is version_unsupported 422", async () => {
    const { status, body } = await search(ucpAgent(`${PLATFORM}/old.json`));
    expect(status).toBe(422);
    expect(code(body)).toBe("version_unsupported");
  });

  test("an operation whose capability is not shared is capabilities_incompatible, 200", async () => {
    const catalogOnly = ucpAgent(`${PLATFORM}/catalog-only.json`);
    expect((await search(catalogOnly)).status).toBe(200);
    const { status, body } = await createCart(catalogOnly);
    expect(status).toBe(200);
    expect(body.ucp.status).toBe("error");
    expect(body.messages[0]).toEqual(
      expect.objectContaining({ code: "capabilities_incompatible", severity: "unrecoverable" }),
    );
    expect(body.continue_url).toBe(`${ORIGIN}/cart`);
    expect(body.id).toBeUndefined();
  });

  test("no common version, or a schema its namespace does not own, leaves the capability out", async () => {
    for (const path of ["/older-checkout.json", "/foreign-checkout.json"]) {
      const { body } = await rest("POST", "/checkout-sessions", {
        body: { line_items: [{ item: { id: "velune-rib-socks-oat-one-size" }, quantity: 1 }] },
        agentHeader: ucpAgent(`${PLATFORM}${path}`),
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      expect(code(body)).toBe("capabilities_incompatible");
      expect((await createCart(ucpAgent(`${PLATFORM}${path}`))).status).toBe(201);
    }
  });

  test("a refused negotiation is not stored under its Idempotency-Key", async () => {
    const key = crypto.randomUUID();
    expect((await createCart(ucpAgent(`${PLATFORM}/old.json`), key)).status).toBe(422);
    expect((await createCart(ucpAgent(`${PLATFORM}/catalog-only.json`), key)).status).toBe(200);
    expect((await createCart(undefined, key)).status).toBe(201);
  });
});

describe("MCP", () => {
  const call = (name: string, args: Record<string, unknown>, headers?: Record<string, string>) =>
    agent.mcp("tools/call", { name, arguments: args }, { headers });

  test("without meta a tool runs on the store's own capabilities (documented deviation)", async () => {
    await agent.signIn();
    const { body } = await call("search_catalog", { catalog: { query: "" } });
    expect(body.result.structuredContent.ucp.status).toBe("success");
  });

  test("meta names the profile; its failures are JSON-RPC -32001 with the UCP code", async () => {
    await agent.signIn();
    const ok = await call("search_catalog", { meta: { "ucp-agent": { profile: PROFILE } } });
    expect(ok.body.result.structuredContent.ucp.status).toBe("success");
    const old = await call("search_catalog", {
      meta: { "ucp-agent": { profile: `${PLATFORM}/old.json` } },
    });
    expect(old.status).toBe(200);
    expect(old.body.error.code).toBe(-32001);
    expect(old.body.error.data).toEqual({
      code: "version_unsupported",
      content: expect.any(String),
      continue_url: `${ORIGIN}/shop`,
    });
  });

  test("capabilities_incompatible is a tool result, not a JSON-RPC error", async () => {
    await agent.signIn();
    const { body } = await call("create_cart", {
      meta: {
        "ucp-agent": { profile: `${PLATFORM}/catalog-only.json` },
        "idempotency-key": crypto.randomUUID(),
      },
      cart: { line_items: [{ item: { id: "velune-rib-socks-oat-one-size" }, quantity: 1 }] },
    });
    expect(body.error).toBeUndefined();
    expect(body.result.structuredContent.messages[0].code).toBe("capabilities_incompatible");
  });

  test("UCP-Agent and meta naming different profiles is refused; the same one is fine", async () => {
    await agent.signIn();
    const args = { meta: { "ucp-agent": { profile: PROFILE } }, catalog: { query: "" } };
    const differ = await call("search_catalog", args, {
      "ucp-agent": ucpAgent(`${PLATFORM}/uncached.json`),
    });
    expect(differ.body.error.code).toBe(-32001);
    expect(differ.body.error.data.code).toBe("invalid_profile_url");
    const same = await call("search_catalog", args, { "ucp-agent": ucpAgent() });
    expect(same.body.result.structuredContent.ucp.status).toBe("success");
  });

  test("a meta profile that is not a string is invalid_profile_url", async () => {
    await agent.signIn();
    const { body } = await call("search_catalog", { meta: { "ucp-agent": { profile: 42 } } });
    expect(body.error.data.code).toBe("invalid_profile_url");
  });
});

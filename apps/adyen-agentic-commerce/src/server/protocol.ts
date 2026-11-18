// Spec: knowledge/components/adyen-agentic-commerce.md
// The HTTP edge for agents: rate limit, bearer token, Poppy-Session, UCP headers, idempotency and
// the trace, in front of the UCP operation table (REST under /ucp/v1, JSON-RPC at /mcp).
import { isIP } from "node:net";
import { CommerceError } from "./commerce";
import { config, UCP_VERSION } from "./config";
import { database } from "./db";
import { type Auth, authenticate, issuer } from "./oauth";
import { PapError, verifyPoppy } from "./pap";
import { negotiate, ProfileError, profileFromHeader } from "./profile";
import { trace } from "./trace";
import {
  capabilitiesIncompatible,
  continueUrl,
  IdentityRequired,
  InvalidParams,
  MUTATIONS,
  negotiationRefusal,
  OP_CAPABILITY,
  OPERATIONS,
  type OpResult,
  REQUIRED_SCOPE,
  routeRest,
  ScopeError,
  STORE_CAPABILITIES,
} from "./ucp";
import { canonicalJson, isRecord, isUuid, json, readJson, sha256 } from "./util";
import { MCP_TOOLS } from "./mcp-tools";

const WINDOW_MS = 60_000;
const LIMIT = 240;
// A caller can still hold many addresses (an IPv6 prefix, or any header on a run without
// Cloudflare); the map must not grow with them.
const BUCKETS_MAX = 10_000;
const buckets = new Map<string, { start: number; count: number }>();

// One map for every per-address limit; a caller prefixes its key so each limit counts apart.
export function rateLimited(key: string, limit = LIMIT): number | undefined {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    if (!bucket && buckets.size >= BUCKETS_MAX) {
      for (const [k, b] of buckets) if (now - b.start > WINDOW_MS) buckets.delete(k);
      // Still full: every address is inside its window, so the oldest one is dropped.
      if (buckets.size >= BUCKETS_MAX) buckets.delete(buckets.keys().next().value!);
    }
    buckets.set(key, { start: now, count: 1 });
    return undefined;
  }
  bucket.count += 1;
  return bucket.count > limit ? Math.ceil((bucket.start + WINDOW_MS - now) / 1000) : undefined;
}

export const trackedRateAddresses = () => buckets.size;

export function publicUrl(request: Request): string {
  const url = new URL(request.url);
  return `${config().publicOrigin}${url.pathname}${url.search}`;
}

// The one client address every per-address limit counts. Render puts Cloudflare in front of every
// public web service: it writes CF-Connecting-IP over any copy the caller sent, but only appends
// to X-Forwarded-For, whose first entry is the caller's to write. So CF-Connecting-IP; without it
// (a local run) the last X-Forwarded-For entry, the one the nearest proxy appended (Next.js sets
// the socket's address when none came); with neither a valid address, one shared "local" client.
// packages/platform's clientAddress applies the same rule; this app does not import it (ADR-012).
export function clientIp(request: Request): string {
  const nearest = request.headers.get("x-forwarded-for")?.split(",").pop();
  for (const candidate of [request.headers.get("cf-connecting-ip"), nearest]) {
    // A dual-stack socket reports an IPv4 client as ::ffff:a.b.c.d.
    const ip = candidate?.trim().replace(/^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i, "");
    if (ip && isIP(ip)) return ip;
  }
  return "local";
}

// RFC 6750 §3 with UCP's realm (the issuer) and RFC 9728's resource_metadata; error only when a
// token was sent, and on 403 the operation's full scope set.
function wwwAuthenticate(resourcePath: string, error?: string, scope?: string) {
  const parts = [
    `realm="${issuer()}"`,
    `resource_metadata="${config().publicOrigin}/.well-known/oauth-protected-resource${resourcePath}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return `Bearer ${parts.join(", ")}`;
}

// UCP's error_response: `ucp` and `messages` only.
function ucpError(code: string, content: string) {
  return {
    ucp: { version: UCP_VERSION, status: "error" },
    messages: [{ type: "error", code, content, severity: "requires_buyer_review" }],
  };
}

type Edge = { auth?: Auth; actor: string; response?: Response };

async function edge(request: Request, resourcePath: "" | "/mcp"): Promise<Edge> {
  const retry = rateLimited(clientIp(request));
  if (retry)
    return {
      actor: "?",
      response: json(429, { error: "rate_limited" }, { "retry-after": String(retry) }),
    };
  const auth = authenticate(request.headers.get("authorization"), resourcePath);
  if (auth === "invalid") {
    const header = { "www-authenticate": wwwAuthenticate(resourcePath, "invalid_token") };
    // MCP clients read OAuth's body; UCP REST platforms read identity_required.
    const body =
      resourcePath === "/mcp"
        ? { error: "invalid_token" }
        : ucpError("identity_required", "The access token is invalid or expired; sign in again.");
    return { actor: "?", response: json(401, body, header) };
  }
  try {
    await verifyPoppy(request, publicUrl(request), auth);
  } catch (error) {
    if (error instanceof PapError)
      return {
        actor: "?",
        response: json(error.status, { error: error.code, error_description: error.message }),
      };
    throw error;
  }
  return { auth, actor: auth?.grant.clientName ?? "anonymous agent" };
}

// --- idempotency -------------------------------------------------------------------------------

// A payment credential is left out of the stored hash: a complete body is fixed but for a network
// token's number and expiry, so its plain hash could be searched offline. The key still binds the
// rest of the body.
function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, k === "credential" ? "-" : withoutCredentials(v)]),
  );
}

function idempotent(
  scope: string,
  key: string,
  payload: unknown,
  run: () => Promise<OpResult>,
): Promise<OpResult> {
  const hash = sha256(canonicalJson(withoutCredentials(payload)));
  const row = database()
    .query<{ request_hash: string; status: number; response: string }, { s: string; k: string }>(
      "select request_hash, status, response from idempotency where scope = $s and key = $k",
    )
    .get({ s: scope, k: key });
  if (row) {
    if (row.request_hash !== hash) {
      return Promise.resolve({
        status: 409,
        body: {
          ucp: { version: UCP_VERSION, status: "error" },
          messages: [
            {
              type: "error",
              code: "idempotency_key_reused",
              content: "This Idempotency-Key was used with another request body",
              severity: "unrecoverable",
            },
          ],
        },
      });
    }
    return Promise.resolve({ status: row.status, body: JSON.parse(row.response) });
  }
  return run().then((result) => {
    // A refused token never ran the operation: a retry with a better token must run it.
    if (result.status < 500 && result.status !== 401 && result.status !== 403) {
      database()
        .query(
          "insert or ignore into idempotency (scope, key, request_hash, status, response, created_at) values ($s, $k, $h, $st, $r, $at)",
        )
        .run({
          s: scope,
          k: key,
          h: hash,
          st: result.status,
          r: JSON.stringify(result.body),
          at: new Date().toISOString(),
        });
    }
    return result;
  });
}

async function runOp(
  op: string,
  args: Record<string, unknown>,
  auth: Auth | undefined,
): Promise<OpResult> {
  try {
    return await OPERATIONS[op]!(args, { auth });
  } catch (error) {
    if (error instanceof InvalidParams) {
      return {
        status: error.status,
        body: { ucp: { version: UCP_VERSION, status: "error" }, messages: [error.msg] },
        rpcCode: -32602,
      };
    }
    if (error instanceof CommerceError) {
      return {
        status: error.status,
        body: { ucp: { version: UCP_VERSION, status: "error" }, messages: [error.msg] },
      };
    }
    if (error instanceof ScopeError)
      return { status: 403, body: ucpError("insufficient_scope", error.message) };
    if (error instanceof IdentityRequired)
      return { status: 401, body: ucpError("identity_required", error.message) };
    throw error;
  }
}

// --- UCP negotiation ---------------------------------------------------------------------------

// A failed discovery is a transport error (REST status, MCP -32001 with `failure` as its data);
// a capability the profile does not share is a 200 UCP answer (an MCP tool result).
type Refusal = OpResult & { failure?: { code: string; content: string; continue_url: string } };

async function negotiation(profileUrl: string, op: string): Promise<Refusal | undefined> {
  try {
    const shared = await negotiate(profileUrl, STORE_CAPABILITIES);
    if (shared.has(OP_CAPABILITY[op]!)) return undefined;
    return { status: 200, body: capabilitiesIncompatible(op) };
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    return refusalOf(error, op);
  }
}

const refusalOf = (error: ProfileError, op: string): Refusal => ({
  status: error.status,
  body: negotiationRefusal(op, error.code, error.message),
  failure: { code: error.code, content: error.message, continue_url: continueUrl(op) },
});

// --- REST --------------------------------------------------------------------------------------

export async function handleRest(request: Request, path: string): Promise<Response> {
  const e = await edge(request, "");
  const url = new URL(request.url);
  const finish = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
    op = "?",
  ) => {
    trace({
      channel: "ucp-rest",
      actor: e.actor,
      method: request.method,
      path: url.pathname,
      status,
      ref: refOf(body),
      detail: { op, response: body },
    });
    return json(status, body, headers);
  };
  if (e.response) {
    trace({
      channel: "ucp-rest",
      actor: e.actor,
      method: request.method,
      path: url.pathname,
      status: e.response.status,
      ref: null,
      detail: { refused: true },
    });
    return e.response;
  }
  const route = routeRest(request.method, path);
  if (!route)
    return finish(404, {
      ucp: { version: UCP_VERSION, status: "error" },
      messages: [
        {
          type: "error",
          code: "not_found",
          content: "Unknown UCP route",
          severity: "unrecoverable",
        },
      ],
    });
  let agent: string | undefined;
  try {
    agent = profileFromHeader(request.headers.get("ucp-agent"));
    if (agent === undefined)
      throw new ProfileError("invalid_profile_url", 'UCP-Agent: profile="<url>" is required');
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    return finish(
      error.status,
      negotiationRefusal(route.op, error.code, error.message),
      {},
      route.op,
    );
  }
  const requestId = request.headers.get("request-id");
  if (!requestId) {
    return finish(
      400,
      {
        ucp: { version: UCP_VERSION, status: "error" },
        messages: [
          {
            type: "error",
            code: "missing_header",
            content: "Request-Id is required",
            severity: "unrecoverable",
          },
        ],
      },
      {},
      route.op,
    );
  }
  const body = request.method === "GET" ? {} : await readJson(request);
  if (body === undefined || !isRecord(body))
    return finish(
      400,
      {
        ucp: { version: UCP_VERSION, status: "error" },
        messages: [
          {
            type: "error",
            code: "invalid_json",
            content: "Body must be a JSON object",
            severity: "unrecoverable",
          },
        ],
      },
      {},
      route.op,
    );
  const args = route.bodyKey ? { ...route.args, [route.bodyKey]: body } : route.args;
  const headers: Record<string, string> = { "request-id": requestId };
  const key = request.headers.get("idempotency-key");
  if (MUTATIONS.has(route.op) && !isUuid(key)) {
    return finish(
      400,
      {
        ucp: { version: UCP_VERSION, status: "error" },
        messages: [
          {
            type: "error",
            code: "missing_idempotency_key",
            content: "Idempotency-Key (UUID) is required on this request",
            severity: "unrecoverable",
          },
        ],
      },
      headers,
      route.op,
    );
  }
  // After the cheap checks, before the operation and its idempotency record: a refused
  // negotiation never ran, so it is never replayed for the key.
  const refusal = await negotiation(agent, route.op);
  if (refusal) return finish(refusal.status, refusal.body, headers, route.op);
  let result: OpResult;
  if (MUTATIONS.has(route.op) && isUuid(key)) {
    result = await idempotent(
      `rest:${e.auth?.token.clientId ?? agent}:${route.op}:${String(args.id ?? "")}`,
      key,
      body,
      () => runOp(route.op, args, e.auth),
    );
  } else {
    result = await runOp(route.op, args, e.auth);
  }
  if (result.status === 403)
    headers["www-authenticate"] = wwwAuthenticate(
      "",
      "insufficient_scope",
      REQUIRED_SCOPE[route.op],
    );
  if (result.status === 401) headers["www-authenticate"] = wwwAuthenticate("");
  return finish(result.status, result.body, headers, route.op);
}

function refOf(body: unknown): string | null {
  return isRecord(body) && typeof body.id === "string" ? body.id : null;
}

// --- MCP (streamable HTTP, JSON responses) -----------------------------------------------------

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: data === undefined ? { code, message } : { code, message, data },
});

export async function handleMcp(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return json(405, rpcError(null, -32000, "Use POST"), { allow: "POST" });
  const e = await edge(request, "/mcp");
  if (e.response) return e.response;
  // Signing in is what lets an agent pay; MCP clients start OAuth on this 401.
  if (!e.auth) {
    return json(
      401,
      { error: "invalid_token", error_description: "Sign in to use the store's tools" },
      { "www-authenticate": wwwAuthenticate("/mcp") },
    );
  }
  const message = await readJson(request);
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return json(400, rpcError(null, -32600, "Invalid JSON-RPC request"));
  }
  const { id, method } = message;
  const params = isRecord(message.params) ? message.params : {};
  if (id === undefined) return new Response(null, { status: 202 });
  const reply = (body: unknown) => {
    trace({
      channel: "mcp",
      actor: e.actor,
      method,
      path: method === "tools/call" ? String(params.name) : "/mcp",
      status: 200,
      ref:
        isRecord(body) && isRecord(body.result) && isRecord(body.result.structuredContent)
          ? refOf(body.result.structuredContent)
          : null,
      detail: { params, response: body },
    });
    return json(200, body);
  };
  switch (method) {
    case "initialize": {
      const asked =
        typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOLS[0]!;
      return reply(
        rpc(id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "atelier-velune-ucp",
            title: "Atelier Velune (UCP demo store)",
            version: "1.0.0",
          },
          instructions:
            "Fashion demo store on Adyen TEST. Search the catalogue, create a checkout with variant ids, then complete it with the instrument listed in checkout.payment.instruments. If status is requires_escalation, give the shopper continue_url. Amounts are EUR minor units.",
        }),
      );
    }
    case "ping":
      return reply(rpc(id, {}));
    case "tools/list":
      return reply(rpc(id, { tools: MCP_TOOLS }));
    case "tools/call": {
      const name = String(params.name ?? "");
      if (!OPERATIONS[name]) return reply(rpcError(id, -32602, `Unknown tool ${name}`));
      const args = isRecord(params.arguments) ? params.arguments : {};
      const meta = isRecord(args.meta) ? args.meta : {};
      // meta["ucp-agent"] is optional here (deviation: generic MCP clients send none); when the
      // HTTP header names a profile too, both must be the same URL (PAP's UCP extension).
      let refusal: Refusal | undefined;
      try {
        const fromHeader = profileFromHeader(request.headers.get("ucp-agent"));
        const declared = meta["ucp-agent"];
        const fromMeta = isRecord(declared) ? declared.profile : undefined;
        if (declared !== undefined && typeof fromMeta !== "string")
          throw new ProfileError("invalid_profile_url", 'meta["ucp-agent"].profile must be a URL');
        if (fromHeader !== undefined && fromMeta !== undefined && fromHeader !== fromMeta)
          throw new ProfileError(
            "invalid_profile_url",
            "UCP-Agent and meta name different profiles",
          );
        const profileUrl = (fromMeta as string | undefined) ?? fromHeader;
        if (profileUrl !== undefined) refusal = await negotiation(profileUrl, name);
      } catch (error) {
        if (!(error instanceof ProfileError)) throw error;
        refusal = refusalOf(error, name);
      }
      if (refusal?.failure)
        return reply(rpcError(id, -32001, "UCP negotiation failed", refusal.failure));
      if (refusal)
        return reply(
          rpc(id, {
            content: [{ type: "text", text: JSON.stringify(refusal.body) }],
            structuredContent: refusal.body,
          }),
        );
      const key = typeof meta["idempotency-key"] === "string" ? meta["idempotency-key"] : undefined;
      const scope = `mcp:${e.auth.token.clientId}:${name}:${String(args.id ?? "")}`;
      const { meta: _meta, ...payload } = args;
      const result =
        MUTATIONS.has(name) && key
          ? await idempotent(scope, key, payload, () => runOp(name, args, e.auth))
          : await runOp(name, args, e.auth);
      if (result.rpcCode !== undefined)
        return reply(rpcError(id, result.rpcCode, "Invalid params", result.body));
      const isError = result.status >= 400;
      return reply(
        rpc(id, {
          content: [{ type: "text", text: JSON.stringify(result.body) }],
          structuredContent: result.body,
          isError,
        }),
      );
    }
    default:
      return reply(rpcError(id, -32601, `Method ${method} not found`));
  }
}

// Spec: knowledge/components/adyen-agentic-commerce.md
// The HTTP edge for agents: rate limit, bearer token, Poppy-Session, UCP headers, idempotency and
// the trace, in front of the UCP operation table (REST under /ucp/v1, JSON-RPC at /mcp).
import { CommerceError } from "./commerce";
import { config, UCP_VERSION } from "./config";
import { database } from "./db";
import { type Auth, authenticate } from "./oauth";
import { PapError, verifyPoppy } from "./pap";
import { trace } from "./trace";
import { MUTATIONS, OPERATIONS, type OpResult, routeRest, ScopeError } from "./ucp";
import { canonicalJson, isRecord, isUuid, json, readJson, sha256 } from "./util";
import { MCP_TOOLS } from "./mcp-tools";

const WINDOW_MS = 60_000;
const LIMIT = 240;
const buckets = new Map<string, { start: number; count: number }>();

export function rateLimited(key: string): number | undefined {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return undefined;
  }
  bucket.count += 1;
  return bucket.count > LIMIT ? Math.ceil((bucket.start + WINDOW_MS - now) / 1000) : undefined;
}

export function publicUrl(request: Request): string {
  const url = new URL(request.url);
  return `${config().publicOrigin}${url.pathname}${url.search}`;
}

const clientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

function wwwAuthenticate(resourcePath: string, error?: string, scope?: string) {
  const parts = [
    `resource_metadata="${config().publicOrigin}/.well-known/oauth-protected-resource${resourcePath}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return `Bearer ${parts.join(", ")}`;
}

type Edge = { auth?: Auth; actor: string; response?: Response };

async function edge(request: Request, resourcePath: string): Promise<Edge> {
  const retry = rateLimited(clientIp(request));
  if (retry)
    return {
      actor: "?",
      response: json(429, { error: "rate_limited" }, { "retry-after": String(retry) }),
    };
  const auth = authenticate(request.headers.get("authorization"));
  if (auth === "invalid") {
    return {
      actor: "?",
      response: json(
        401,
        { error: "invalid_token" },
        { "www-authenticate": wwwAuthenticate(resourcePath, "invalid_token") },
      ),
    };
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

function idempotent(
  scope: string,
  key: string,
  payload: unknown,
  run: () => Promise<OpResult>,
): Promise<OpResult> {
  const hash = sha256(canonicalJson(payload));
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
    if (result.status < 500) {
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
    if (error instanceof CommerceError) {
      return {
        status: error.status,
        body: { ucp: { version: UCP_VERSION, status: "error" }, messages: [error.msg] },
      };
    }
    if (error instanceof ScopeError) {
      return {
        status: 403,
        body: { error: "insufficient_scope", error_description: error.message, scope: error.scope },
      };
    }
    throw error;
  }
}

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
  const agent = /profile="([^"]+)"/.exec(request.headers.get("ucp-agent") ?? "")?.[1];
  const requestId = request.headers.get("request-id");
  if (!agent || !requestId) {
    return finish(
      400,
      {
        ucp: { version: UCP_VERSION, status: "error" },
        messages: [
          {
            type: "error",
            code: "missing_header",
            content: 'UCP-Agent: profile="<url>" and Request-Id are required',
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
  let result: OpResult;
  if (MUTATIONS.has(route.op)) {
    const key = request.headers.get("idempotency-key");
    if (!isUuid(key)) {
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
    headers["www-authenticate"] = wwwAuthenticate("", "insufficient_scope");
  return finish(result.status, result.body, headers, route.op);
}

function refOf(body: unknown): string | null {
  return isRecord(body) && typeof body.id === "string" ? body.id : null;
}

// --- MCP (streamable HTTP, JSON responses) -----------------------------------------------------

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
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
      const key = typeof meta["idempotency-key"] === "string" ? meta["idempotency-key"] : undefined;
      const scope = `mcp:${e.auth.token.clientId}:${name}:${String(args.id ?? "")}`;
      const { meta: _meta, ...payload } = args;
      const result =
        MUTATIONS.has(name) && key
          ? await idempotent(scope, key, payload, () => runOp(name, args, e.auth))
          : await runOp(name, args, e.auth);
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

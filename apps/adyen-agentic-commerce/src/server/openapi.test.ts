// The OpenAPI description must say what the server does: each path routes to the operation its
// operationId names, and the declared token rules, scopes, statuses and headers match the answers.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./api";
import { productById, variantById } from "./catalog";
import { UCP_VERSION } from "./config";
import { MCP_TOOLS } from "./mcp-tools";
import { ADVERTISED_SCOPES } from "./oauth";
import { OPENAPI_OPERATIONS, openApi } from "./openapi";
import { freshStore, ORIGIN, randomIp, TestAgent } from "./testing/agent";
import { ucpAgent } from "./testing/platform";
import { OPERATIONS, routeRest } from "./ucp";

type Op = {
  operationId: string;
  security: Record<string, string[]>[];
  parameters: { $ref: string }[];
  responses: Record<string, unknown>;
  requestBody?: { content: { "application/json": { example?: unknown } } };
};

const doc = openApi();
const ops = OPENAPI_OPERATIONS.map((o) => ({
  ...o,
  spec: (doc.paths[o.path] as Record<string, Op>)[o.method]!,
  concrete: o.path.replace("{id}", "x_unknown"),
}));

let agent: TestAgent;

beforeAll(async () => {
  agent = await TestAgent.start("OpenAPI agent");
});
afterAll(() => agent.stop());
beforeEach(() => {
  freshStore();
  agent.accessToken = "";
});

function call(op: (typeof ops)[number], headers: Record<string, string> = {}) {
  return handle(
    new Request(`${ORIGIN}/ucp/v1${op.concrete}`, {
      method: op.method.toUpperCase(),
      headers: {
        "content-type": "application/json",
        "ucp-agent": ucpAgent(),
        "request-id": crypto.randomUUID(),
        "x-forwarded-for": randomIp(),
        ...headers,
      },
      body: op.method === "get" ? undefined : "{}",
    }),
  );
}

const declaredScope = (op: Op): string | undefined =>
  op.security.find((s) => s.oauth?.length)?.oauth?.[0];
const anonymousAllowed = (op: Op) => op.security.some((s) => Object.keys(s).length === 0);
const hasParam = (op: Op, name: string) =>
  op.parameters.some((p) => p.$ref === `#/components/parameters/${name}`);

describe("structure", () => {
  test("is served as OpenAPI 3.1 on the REST base", async () => {
    const response = await handle(new Request(`${ORIGIN}/ucp/v1/openapi.json`));
    expect(response.status).toBe(200);
    const served = await response.json();
    expect(served.openapi).toBe("3.1.0");
    expect(served.info.version).toBe(UCP_VERSION);
    expect(served.servers).toEqual([{ url: `${ORIGIN}/ucp/v1` }]);
  });

  test("every path routes to the operation its operationId names, each operation once", () => {
    for (const op of ops) {
      expect(
        `${op.method} ${op.path} -> ${routeRest(op.method.toUpperCase(), op.concrete)?.op}`,
      ).toBe(`${op.method} ${op.path} -> ${op.operationId}`);
      expect(op.spec.operationId).toBe(op.operationId);
    }
    const ids = ops.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(OPERATIONS).sort());
  });

  test("the operationIds are the MCP tool names", () => {
    expect(ops.map((o) => o.operationId).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  test("the OAuth scheme offers the advertised scopes, and every operation uses one of them", () => {
    const flow = doc.components.securitySchemes.oauth.flows.authorizationCode;
    expect(Object.keys(flow.scopes)).toEqual(ADVERTISED_SCOPES);
    for (const op of ops) {
      const scope = declaredScope(op.spec);
      if (scope) expect(ADVERTISED_SCOPES as string[]).toContain(scope);
    }
  });

  test("every schema refers to UCP's published schemas for this version", () => {
    for (const [name, schema] of Object.entries(doc.components.schemas))
      expect(`${name} ${schema.$ref}`).toContain(`https://ucp.dev/${UCP_VERSION}/schemas/`);
    const text = JSON.stringify(doc);
    for (const [, kind, name] of text.matchAll(/"#\/components\/(\w+)\/(\w+)"/g))
      expect(
        (doc.components as Record<string, Record<string, unknown>>)[kind!]?.[name!],
      ).toBeDefined();
  });

  test("the examples name real catalogue items", () => {
    const text = JSON.stringify(doc);
    for (const [, id] of text.matchAll(/"id":"(velune-[a-z0-9-]+)"/g))
      expect(`${id} ${Boolean(variantById(id!) ?? productById(id!))}`).toBe(`${id} true`);
  });

  // 422 and 424 are the profile negotiation's; a create also documents its 200 refusal body.
  test("statuses: 400, 401, 422, 424 and 429 always; 403 with a scope; 404 with an id; 409 on mutations", () => {
    for (const op of ops) {
      const statuses = Object.keys(op.spec.responses).sort();
      const created =
        (op.path === "/carts" || op.path === "/checkout-sessions") && op.method === "post";
      const expected = [
        ...(created ? ["201", "200"] : ["200"]),
        "400",
        "401",
        "422",
        "424",
        "429",
        ...(declaredScope(op.spec) ? ["403"] : []),
        ...(op.path.includes("{id}") ? ["404"] : []),
        ...(hasParam(op.spec, "idempotency_key") ? ["409"] : []),
      ].sort();
      expect(`${op.operationId} ${statuses}`).toBe(`${op.operationId} ${expected}`);
    }
  });
});

describe("the server keeps to it", () => {
  test("a call without a token is refused exactly where the document requires one", async () => {
    for (const op of ops) {
      const status = (await call(op, { "idempotency-key": crypto.randomUUID() })).status;
      expect(`${op.operationId} ${status === 401}`).toBe(
        `${op.operationId} ${!anonymousAllowed(op.spec)}`,
      );
    }
  });

  test("Idempotency-Key is required exactly where the document lists it", async () => {
    for (const op of ops) {
      const body = await (await call(op)).json();
      const demanded = body.messages?.[0]?.code === "missing_idempotency_key";
      expect(`${op.operationId} ${demanded}`).toBe(
        `${op.operationId} ${hasParam(op.spec, "idempotency_key")}`,
      );
    }
  });

  test("a token without an operation's declared scope is 403 naming that scope", async () => {
    const needed = [...new Set(ops.map((o) => declaredScope(o.spec)).filter(Boolean))] as string[];
    for (const scope of needed) {
      const others = ADVERTISED_SCOPES.filter((s) => s !== scope);
      await agent.signIn({ ask: others.join(" "), scopes: others });
      for (const op of ops) {
        const response = await call(op, {
          authorization: `Bearer ${agent.accessToken}`,
          "idempotency-key": crypto.randomUUID(),
        });
        const refused = response.status === 403;
        expect(`${op.operationId} without ${scope}: ${refused}`).toBe(
          `${op.operationId} without ${scope}: ${declaredScope(op.spec) === scope}`,
        );
        if (refused) expect(response.headers.get("www-authenticate")).toContain(`scope="${scope}"`);
      }
    }
  });
});

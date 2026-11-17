// Spec: knowledge/components/adyen-agentic-commerce.md
// OpenAPI 3.1 for the UCP REST binding, for PAP's `apis` entry of type openapi: UCP's own
// operationIds and canonical schemas, with this store's token rules and error statuses per
// operation. Scopes come from REQUIRED_SCOPE and HARD_GATES, the table the server checks.
import { config, UCP_VERSION } from "./config";
import { ADVERTISED_SCOPES, DEVICE_GRANT, SCOPES } from "./oauth";
import { HARD_GATES, MUTATIONS, REQUIRED_SCOPE } from "./ucp";

const UCP = `https://ucp.dev/${UCP_VERSION}`;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// The same names and targets as UCP's services/shopping/rest.openapi.json.
const SCHEMAS = {
  checkout: { $ref: `${UCP}/schemas/shopping/checkout.json` },
  cart: { $ref: `${UCP}/schemas/shopping/cart.json` },
  order: { $ref: `${UCP}/schemas/shopping/order.json` },
  catalog_search_request: {
    $ref: `${UCP}/schemas/shopping/catalog_search.json#/$defs/search_request`,
  },
  catalog_search_response: {
    $ref: `${UCP}/schemas/shopping/catalog_search.json#/$defs/search_response`,
  },
  catalog_lookup_request: {
    $ref: `${UCP}/schemas/shopping/catalog_lookup.json#/$defs/lookup_request`,
  },
  catalog_lookup_response: {
    $ref: `${UCP}/schemas/shopping/catalog_lookup.json#/$defs/lookup_response`,
  },
  catalog_get_product_request: {
    $ref: `${UCP}/schemas/shopping/catalog_lookup.json#/$defs/get_product_request`,
  },
  catalog_get_product_response: {
    $ref: `${UCP}/schemas/shopping/catalog_lookup.json#/$defs/get_product_response`,
  },
  error_response: { $ref: `${UCP}/schemas/common/types/error_response.json` },
};

type Operation = {
  path: string;
  method: "get" | "post" | "put";
  operationId: string;
  summary: string;
  request?: keyof typeof SCHEMAS;
  created?: boolean;
  response: keyof typeof SCHEMAS;
  example?: { request?: unknown; responses?: Record<string, unknown> };
};

// A real variant: the black leather crossbody bag, 149 EUR.
const BAG = "velune-crossbody-black-one-size";

const OPERATIONS: Operation[] = [
  {
    path: "/catalog/search",
    method: "post",
    operationId: "search_catalog",
    summary: "Search the catalogue",
    request: "catalog_search_request",
    response: "catalog_search_response",
    example: {
      request: { query: "leather", filters: { categories: ["bags"], price: { max: 20000 } } },
    },
  },
  {
    path: "/catalog/lookup",
    method: "post",
    operationId: "lookup_catalog",
    summary: "Look up products or variants by id",
    request: "catalog_lookup_request",
    response: "catalog_lookup_response",
    example: { request: { ids: [BAG] } },
  },
  {
    path: "/catalog/product",
    method: "post",
    operationId: "get_product",
    summary: "Get one product with its variants",
    request: "catalog_get_product_request",
    response: "catalog_get_product_response",
    example: { request: { id: "velune-crossbody" } },
  },
  {
    path: "/carts",
    method: "post",
    operationId: "create_cart",
    summary: "Create a cart",
    request: "cart",
    created: true,
    response: "cart",
    example: { request: { line_items: [{ item: { id: BAG }, quantity: 1 }] } },
  },
  {
    path: "/carts/{id}",
    method: "get",
    operationId: "get_cart",
    summary: "Get a cart",
    response: "cart",
  },
  {
    path: "/carts/{id}",
    method: "put",
    operationId: "update_cart",
    summary: "Replace a cart's lines",
    request: "cart",
    response: "cart",
  },
  {
    path: "/carts/{id}/cancel",
    method: "post",
    operationId: "cancel_cart",
    summary: "Cancel a cart",
    response: "cart",
  },
  {
    path: "/checkout-sessions",
    method: "post",
    operationId: "create_checkout",
    summary: "Create a checkout; the server prices it",
    request: "checkout",
    created: true,
    response: "checkout",
    example: {
      request: {
        line_items: [{ item: { id: BAG }, quantity: 1 }],
        buyer: { email: "shopper@example.com" },
      },
    },
  },
  {
    path: "/checkout-sessions/{id}",
    method: "get",
    operationId: "get_checkout",
    summary: "Get a checkout",
    response: "checkout",
  },
  {
    path: "/checkout-sessions/{id}",
    method: "put",
    operationId: "update_checkout",
    summary: "Update a checkout's lines or buyer",
    request: "checkout",
    response: "checkout",
  },
  {
    path: "/checkout-sessions/{id}/complete",
    method: "post",
    operationId: "complete_checkout",
    summary: "Pay with a saved card or the agent's own network token and place the order",
    request: "checkout",
    response: "checkout",
    example: {
      request: {
        payment: {
          instruments: [
            { id: "card_0123456789abcdef0123", handler_id: "saved_card", type: "card" },
          ],
        },
      },
      responses: {
        completed: {
          status: "completed",
          order: { id: "ord_…", permalink_url: "https://…/orders/ord_…" },
        },
        requires_escalation: {
          status: "requires_escalation",
          continue_url: "https://…/checkout/chk_…",
          messages: [
            {
              type: "error",
              code: "spend_limit_exceeded",
              content:
                "Total 14900 exceeds the remaining agent budget of 10000 EUR minor units; the shopper must approve at continue_url.",
              severity: "requires_buyer_review",
            },
          ],
        },
      },
    },
  },
  {
    path: "/checkout-sessions/{id}/cancel",
    method: "post",
    operationId: "cancel_checkout",
    summary: "Cancel a checkout",
    response: "checkout",
  },
  {
    path: "/orders/{id}",
    method: "get",
    operationId: "get_order",
    summary: "Get an order this agent placed",
    response: "order",
  },
];

const errorExample = (code: string, content: string) => ({
  ucp: { version: UCP_VERSION, status: "error" },
  messages: [{ type: "error", code, content, severity: "requires_buyer_review" }],
});

// Negotiation refusals carry continue_url, where the shopper can carry on by hand.
const negotiationExample = (code: string, content: string) => ({
  ucp: { version: UCP_VERSION, status: "error" },
  messages: [{ type: "error", code, content, severity: "unrecoverable" }],
  continue_url: `${config().publicOrigin}/shop`,
});

const challenge = {
  "WWW-Authenticate": {
    description: 'Bearer realm="<issuer>", resource_metadata="…"; error and scope when they apply',
    schema: { type: "string" },
  },
};

function errorResponse(description: string, example?: unknown, headers?: unknown) {
  return {
    description,
    ...(headers ? { headers } : {}),
    content: {
      "application/json": {
        schema: ref("error_response"),
        ...(example ? { example } : {}),
      },
    },
  };
}

// Token rules: no scope, any token or none; an optional-layer scope, none or a token with it;
// a hard gate, a token with it.
function security(operationId: string) {
  const scope = REQUIRED_SCOPE[operationId];
  if (!scope) return [{}, { oauth: [] }];
  return HARD_GATES.includes(scope) ? [{ oauth: [scope] }] : [{}, { oauth: [scope] }];
}

function operation(op: Operation) {
  const scope = REQUIRED_SCOPE[op.operationId];
  const hard = scope !== undefined && HARD_GATES.includes(scope);
  const mutation = MUTATIONS.has(op.operationId);
  const parameters = [
    { $ref: "#/components/parameters/ucp_agent" },
    { $ref: "#/components/parameters/request_id" },
    ...(mutation ? [{ $ref: "#/components/parameters/idempotency_key" }] : []),
    ...(op.path.includes("{id}") ? [{ $ref: "#/components/parameters/id" }] : []),
  ];
  const tokenNote = !scope
    ? "A token is optional."
    : hard
      ? `Needs a token with ${scope}.`
      : `A token is optional; one that is sent must carry ${scope}.`;
  const success = op.example?.responses
    ? {
        examples: Object.fromEntries(
          Object.entries(op.example.responses).map(([name, value]) => [name, { value }]),
        ),
      }
    : {};
  return {
    operationId: op.operationId,
    summary: op.summary,
    description: tokenNote,
    security: security(op.operationId),
    parameters,
    ...(op.request
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ref(op.request),
                ...(op.example?.request ? { example: op.example.request } : {}),
              },
            },
          },
        }
      : {}),
    responses: {
      [op.created ? "201" : "200"]: {
        description: op.created
          ? "UCP response"
          : "UCP response; or, when the platform profile shares no capability the operation needs, an error body with capabilities_incompatible",
        content: { "application/json": { schema: ref(op.response), ...success } },
      },
      ...(op.created
        ? {
            "200": errorResponse(
              "The platform profile shares no capability this operation needs",
              negotiationExample("capabilities_incompatible", "No compatible capability"),
            ),
          }
        : {}),
      "400": errorResponse(
        "UCP-Agent missing or naming a refused profile URL (invalid_profile_url), no Request-Id, a body that is not a JSON object, or invalid input",
        negotiationExample("invalid_profile_url", 'UCP-Agent: profile="<url>" is required'),
      ),
      "422": errorResponse(
        "The platform profile is malformed (profile_malformed) or names another UCP version (version_unsupported)",
        negotiationExample("version_unsupported", `This business implements ${UCP_VERSION}`),
      ),
      "424": errorResponse(
        "The platform profile could not be fetched: an error status, a redirect or a timeout",
        negotiationExample("profile_unreachable", "The profile URL answered 404"),
      ),
      "401": errorResponse(
        hard ? "No token, or an invalid or expired one" : "An invalid or expired token was sent",
        errorExample("identity_required", "The access token is invalid or expired; sign in again."),
        challenge,
      ),
      ...(scope
        ? {
            "403": errorResponse(
              "The token lacks the operation's scope",
              errorExample("insufficient_scope", `This operation requires scopes: ${scope}`),
              challenge,
            ),
          }
        : {}),
      ...(op.path.includes("{id}")
        ? { "404": errorResponse("Unknown id, or one that belongs to another agent") }
        : {}),
      ...(mutation
        ? {
            "409": errorResponse(
              "This Idempotency-Key was used with another body",
              errorExample(
                "idempotency_key_reused",
                "This Idempotency-Key was used with another request body",
              ),
            ),
          }
        : {}),
      "429": {
        description: "Rate limited",
        headers: { "Retry-After": { schema: { type: "integer" } } },
      },
    },
  };
}

export const OPENAPI_OPERATIONS: readonly Pick<Operation, "path" | "method" | "operationId">[] =
  OPERATIONS;

export function openApi() {
  const origin = config().publicOrigin;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    paths[op.path] = { ...paths[op.path], [op.method]: operation(op) };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Atelier Velune UCP shopping service",
      version: UCP_VERSION,
      description: `UCP ${UCP_VERSION} REST binding (canonical description: ${UCP}/services/shopping/rest.openapi.json). Amounts are EUR minor units and the server prices everything. Adyen TEST only. Errors use UCP's error_response; 401 and 403 carry a Bearer challenge with the issuer as realm. Agents whose browser cannot reach a callback can sign in with the device grant (${DEVICE_GRANT}) at ${origin}/oauth/device_authorization.`,
    },
    servers: [{ url: `${origin}/ucp/v1` }],
    security: [{}, { oauth: [] }],
    components: {
      securitySchemes: {
        oauth: {
          type: "oauth2",
          description: "PKCE S256. Discovery: /.well-known/oauth-authorization-server.",
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/oauth/authorize`,
              tokenUrl: `${origin}/oauth/token`,
              refreshUrl: `${origin}/oauth/token`,
              scopes: Object.fromEntries(ADVERTISED_SCOPES.map((s) => [s, SCOPES[s].label])),
            },
          },
        },
      },
      parameters: {
        ucp_agent: {
          name: "UCP-Agent",
          in: "header",
          required: true,
          description: "The agent's UCP profile.",
          schema: { type: "string" },
          example: 'profile="https://agent.example/.well-known/ucp"',
        },
        request_id: {
          name: "Request-Id",
          in: "header",
          required: true,
          description: "Echoed on the response.",
          schema: { type: "string" },
        },
        idempotency_key: {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          description: "A fresh UUID per distinct attempt; reuse it to retry safely.",
          schema: { type: "string", format: "uuid" },
        },
        id: { name: "id", in: "path", required: true, schema: { type: "string" } },
      },
      schemas: SCHEMAS,
    },
    paths,
  };
}

// Spec: knowledge/components/adyen-agentic-commerce.md
// A short OpenAPI 3.1 map of the UCP REST binding, for PAP's `apis` entry of type openapi.
import { config, UCP_VERSION } from "./config";

const headers = [
  { name: "UCP-Agent", in: "header", required: true, schema: { type: "string" }, example: 'profile="https://agent.example/.well-known/ucp"' },
  { name: "Request-Id", in: "header", required: true, schema: { type: "string" } },
];
const mutation = [...headers, { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", format: "uuid" } }];
const id = { name: "id", in: "path", required: true, schema: { type: "string" } };
const op = (summary: string, parameters: unknown[], body = false) => ({
  summary,
  parameters,
  ...(body ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } } } : {}),
  responses: { "200": { description: "UCP response" }, "400": { description: "UCP error messages" } },
});

export function openApi() {
  const schema = `https://ucp.dev/${UCP_VERSION}/services/shopping/rest.openapi.json`;
  return {
    openapi: "3.1.0",
    info: { title: "Atelier Velune UCP shopping service", version: UCP_VERSION, description: `UCP ${UCP_VERSION} REST binding; canonical schema: ${schema}. Adyen TEST only.` },
    servers: [{ url: `${config().publicOrigin}/ucp/v1` }],
    components: { securitySchemes: { oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: `${config().publicOrigin}/oauth/authorize`, tokenUrl: `${config().publicOrigin}/oauth/token`, scopes: { "ucp:checkout": "Checkouts", "ucp:pay": "Pay with the saved card", "ucp:orders": "Orders", profile: "Name and email" } } } } } },
    paths: {
      "/catalog/search": { post: op("Search the catalogue", headers, true) },
      "/catalog/lookup": { post: op("Look up products or variants", headers, true) },
      "/catalog/product": { post: op("Get one product", headers, true) },
      "/carts": { post: op("Create a cart", mutation, true) },
      "/carts/{id}": { get: op("Get a cart", [...headers, id]), put: op("Update a cart", [...mutation, id], true) },
      "/carts/{id}/cancel": { post: op("Cancel a cart", [...mutation, id]) },
      "/checkout-sessions": { post: op("Create a checkout", mutation, true) },
      "/checkout-sessions/{id}": { get: op("Get a checkout", [...headers, id]), put: op("Update a checkout", [...mutation, id], true) },
      "/checkout-sessions/{id}/complete": { post: op("Pay and place the order", [...mutation, id], true) },
      "/checkout-sessions/{id}/cancel": { post: op("Cancel a checkout", [...mutation, id]) },
      "/orders/{id}": { get: op("Get an order", [...headers, id]) },
    },
  };
}

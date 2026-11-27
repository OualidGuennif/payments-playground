// Spec: knowledge/components/adyen-agentic-commerce.md
// MCP tool descriptors for the UCP shopping operations (names and argument keys from UCP's OpenRPC).
import { toolUiMeta } from "./widgets";
import { CATEGORIES } from "../catalog/catalog";

const meta = (required: boolean) => ({
  type: "object",
  description: required
    ? "Request metadata. Send idempotency-key (a fresh UUID per distinct attempt; reuse it to retry safely)."
    : "Request metadata (optional here).",
  properties: {
    "ucp-agent": { type: "object", properties: { profile: { type: "string", format: "uri" } } },
    "idempotency-key": { type: "string", format: "uuid" },
  },
});

const lineItems = {
  type: "array",
  description: "Variant ids from the catalogue (colour and size), with a quantity from 1 to 10.",
  items: {
    type: "object",
    required: ["item"],
    properties: {
      item: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      quantity: { type: "integer", minimum: 1, maximum: 10 },
    },
  },
};

const buyer = {
  type: "object",
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
    email: { type: "string" },
  },
};

// UCP search_filters, read the same way by search, lookup and product.
const filters = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      description: "Any of these categories.",
      items: { enum: CATEGORIES.map((c) => c.id) },
    },
    price: {
      type: "object",
      description: "EUR minor units.",
      properties: { min: { type: "integer" }, max: { type: "integer" } },
    },
  },
};

const tool = (
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly: boolean,
) => ({
  name,
  title,
  description,
  inputSchema: { type: "object", properties, required },
  annotations: {
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: readOnly,
    openWorldHint: false,
  },
});

const id = { type: "string" };

const UCP_TOOLS = [
  tool(
    "search_catalog",
    "Search the catalogue",
    "Search clothes, bags and accessories. Empty query lists everything, 10 per page: pass pagination.cursor from the answer for the next page. Prices are EUR minor units.",
    {
      meta: meta(false),
      catalog: {
        type: "object",
        properties: {
          query: { type: "string" },
          filters,
          pagination: {
            type: "object",
            properties: {
              cursor: { type: "string", description: "pagination.cursor from the previous page." },
              limit: {
                type: "integer",
                minimum: 1,
                description: "Page size, 10 by default, 50 at most.",
              },
            },
          },
        },
      },
    },
    [],
    true,
  ),
  tool(
    "lookup_catalog",
    "Look up products",
    "Fetch products by product or variant id (at most 50 distinct ids). Each variant lists the ids that resolved to it in inputs: exact for a variant id, featured for a product id.",
    {
      meta: meta(false),
      catalog: {
        type: "object",
        required: ["ids"],
        properties: { ids: { type: "array", minItems: 1, items: { type: "string" } }, filters },
      },
    },
    ["catalog"],
    true,
  ),
  tool(
    "get_product",
    "Get a product",
    "One product by product or variant id: selected holds the chosen colour and size, variants the ones matching it, options each value's availability. Send selected to narrow it, and preferences, the options in priority order (the last is dropped first when nothing matches).",
    {
      meta: meta(false),
      catalog: {
        type: "object",
        required: ["id"],
        properties: {
          id,
          selected: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "label"],
              properties: {
                name: { enum: ["colour", "size"] },
                id: { type: "string" },
                label: { type: "string" },
              },
            },
          },
          preferences: { type: "array", items: { enum: ["colour", "size"] } },
          filters,
        },
      },
    },
    ["catalog"],
    true,
  ),
  tool(
    "create_cart",
    "Create a cart",
    "Start a cart with line items.",
    {
      meta: meta(false),
      cart: { type: "object", required: ["line_items"], properties: { line_items: lineItems } },
    },
    ["cart"],
    false,
  ),
  tool("get_cart", "Get a cart", "Read a cart.", { meta: meta(false), id }, ["id"], true),
  tool(
    "update_cart",
    "Update a cart",
    "Replace the cart's line items.",
    { meta: meta(false), id, cart: { type: "object", properties: { line_items: lineItems } } },
    ["id", "cart"],
    false,
  ),
  tool("cancel_cart", "Cancel a cart", "Cancel a cart.", { meta: meta(true), id }, ["id"], false),
  tool(
    "create_checkout",
    "Create a checkout",
    "Create a checkout from line items, or from a cart_id whose lines and buyer then win. The server prices it; read status, totals and payment.instruments in the answer.",
    {
      meta: meta(false),
      checkout: {
        type: "object",
        properties: { line_items: lineItems, cart_id: { type: "string" }, buyer },
      },
    },
    ["checkout"],
    false,
  ),
  tool(
    "get_checkout",
    "Get a checkout",
    "Read a checkout, its status and messages.",
    { meta: meta(false), id },
    ["id"],
    true,
  ),
  tool(
    "update_checkout",
    "Update a checkout",
    "Replace line items or set the buyer.",
    {
      meta: meta(false),
      id,
      checkout: { type: "object", properties: { line_items: lineItems, buyer } },
    },
    ["id", "checkout"],
    false,
  ),
  tool(
    "complete_checkout",
    "Pay and place the order",
    "Pays on Adyen TEST when status is ready_for_complete. Choose one: a saved card (handler_id saved_card, the id from get_checkout; needs sign-in), your own network token (handler_id network_token, credential with its number and expiry only), or no instrument to hand the shopper continue_url, where they pay themselves. If the answer says requires_escalation, show the shopper continue_url.",
    {
      meta: meta(true),
      id,
      checkout: {
        type: "object",
        properties: {
          payment: {
            type: "object",
            properties: {
              instruments: {
                type: "array",
                items: {
                  type: "object",
                  required: ["handler_id", "type"],
                  properties: {
                    id,
                    handler_id: { enum: ["saved_card", "network_token"] },
                    type: { const: "card" },
                    selected: { type: "boolean" },
                    credential: {
                      type: "object",
                      description:
                        "network_token only: type network_token, number, expiry_month, expiry_year, optional name; no cryptogram, CVC or brand (schema at /ucp/v1/handlers/network_token.json)",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    ["id", "checkout"],
    false,
  ),
  tool(
    "cancel_checkout",
    "Cancel a checkout",
    "Cancel a checkout that is not paid.",
    { meta: meta(true), id },
    ["id"],
    false,
  ),
  tool(
    "get_order",
    "Get an order",
    "Read an order placed through this store.",
    { meta: meta(false), id },
    ["id"],
    true,
  ),
];

// A payment reaches Adyen and cannot be taken back by the agent, and a cancel ends a cart or a
// checkout: hosts that honour these hints ask the shopper first (ADR-017).
const HINTS: Record<string, { destructiveHint: boolean; openWorldHint?: boolean }> = {
  complete_checkout: { destructiveHint: true, openWorldHint: true },
  cancel_cart: { destructiveHint: true },
  cancel_checkout: { destructiveHint: true },
};

export const MCP_TOOLS = UCP_TOOLS.map((t) => {
  const ui = toolUiMeta(t.name);
  return {
    ...t,
    annotations: { ...t.annotations, ...HINTS[t.name] },
    ...(ui ? { _meta: ui } : {}),
  };
});

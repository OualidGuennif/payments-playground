// Spec: knowledge/components/adyen-agentic-commerce.md
// MCP tool descriptors for the UCP shopping operations (names and argument keys from UCP's OpenRPC).

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

export const MCP_TOOLS = [
  tool(
    "search_catalog",
    "Search the catalogue",
    "Search clothes, bags and accessories. Empty query lists everything. Prices are EUR minor units.",
    {
      meta: meta(false),
      catalog: {
        type: "object",
        properties: {
          query: { type: "string" },
          filters: {
            type: "object",
            properties: {
              category: { enum: ["clothing", "bags", "accessories"] },
              price: { type: "object", properties: { max: { type: "integer" } } },
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
    "Fetch products by product or variant id.",
    {
      meta: meta(false),
      catalog: {
        type: "object",
        required: ["ids"],
        properties: { ids: { type: "array", items: { type: "string" } } },
      },
    },
    ["catalog"],
    true,
  ),
  tool(
    "get_product",
    "Get a product",
    "One product with all its variants (colour, size, availability).",
    { meta: meta(false), catalog: { type: "object", required: ["id"], properties: { id } } },
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
    "Create a checkout from line items (or a cart_id). The server prices it; read status, totals and payment.instruments in the answer.",
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
    "Pays with the shopper's saved card on Adyen TEST when status is ready_for_complete. Pass checkout.payment.instruments with the instrument id from get_checkout. If the answer says requires_escalation, show the shopper continue_url.",
    {
      meta: meta(true),
      id,
      checkout: {
        type: "object",
        required: ["payment"],
        properties: {
          payment: {
            type: "object",
            properties: {
              instruments: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "handler_id", "type"],
                  properties: { id, handler_id: { const: "saved_card" }, type: { const: "card" } },
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

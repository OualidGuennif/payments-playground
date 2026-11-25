// Spec: knowledge/components/adyen-agentic-commerce.md
// The Docs pages as data: who talks to whom, in order, with the real endpoints of this store. The
// diagram and the text list both come from these steps, so they cannot disagree. `code` spans are
// written between backticks.

export type Actor = { id: string; label: string };

export type Step = {
  from: string;
  to: string;
  label: string;
  text: string;
  // An answer to the step before it: drawn dashed.
  reply?: boolean;
};

// Try it sends only these, from the visitor's browser, to this origin: GETs of public documents
// and MCP tools/list. Nothing here pays, signs in or changes state.
export type TryRequest =
  | { method: "GET"; path: PublicDocument; label: string }
  | { method: "POST"; path: "/mcp"; label: string; body: { method: "tools/list" } };

export const PUBLIC_DOCUMENTS = [
  "/.well-known/poppy.json",
  "/.well-known/ucp",
  "/.well-known/oauth-authorization-server",
] as const;
type PublicDocument = (typeof PUBLIC_DOCUMENTS)[number];

export type Note = { id?: string; title: string; body: string[] };

export type Doc = {
  slug: string;
  title: string;
  short: string;
  intro: string;
  actors: Actor[];
  steps: Step[];
  notes: Note[];
  tries: TryRequest[];
  // The Back Office log channels where these messages show up.
  channels: string[];
};

const TOOLS_LIST: TryRequest = {
  method: "POST",
  path: "/mcp",
  label: "POST /mcp tools/list, without a token",
  body: { method: "tools/list" },
};
const AUTH_SERVER: TryRequest = {
  method: "GET",
  path: "/.well-known/oauth-authorization-server",
  label: "GET /.well-known/oauth-authorization-server",
};

export const OVERVIEW: Pick<Doc, "actors" | "steps"> = {
  actors: [
    { id: "you", label: "You" },
    { id: "agent", label: "AI agent" },
    { id: "store", label: "Atelier Velune" },
    { id: "adyen", label: "Adyen TEST" },
  ],
  steps: [
    {
      from: "you",
      to: "agent",
      label: "“Buy the linen shirt in M”",
      text: "You ask your assistant to shop. It has never seen this store before.",
    },
    {
      from: "agent",
      to: "store",
      label: "Discover",
      text: "It reads `/.well-known/poppy.json` and `/.well-known/ucp`: how to sign in, which tools exist, how payment works.",
    },
    {
      from: "agent",
      to: "you",
      label: "Sign in here",
      text: "It sends you to this store's sign-in. You see its name and what it asks for, choose a budget and allow it.",
    },
    {
      from: "agent",
      to: "store",
      label: "Search, checkout",
      text: "With the token it got, it calls `search_catalog`, then `create_checkout`. The store prices everything.",
    },
    {
      from: "agent",
      to: "store",
      label: "Complete with your saved card",
      text: "`complete_checkout` names one of your saved cards. The store checks the total fits the budget you set.",
    },
    {
      from: "store",
      to: "adyen",
      label: "POST /payments",
      text: "The store charges the card on Adyen TEST as a merchant-initiated payment. The agent never sees the card.",
    },
    {
      from: "adyen",
      to: "store",
      label: "Authorised",
      text: "Adyen answers at once; a webhook confirms it later, checked against its HMAC signature.",
      reply: true,
    },
    {
      from: "store",
      to: "agent",
      label: "Order placed",
      text: "The answer carries the order and what is left of the budget.",
      reply: true,
    },
    {
      from: "agent",
      to: "you",
      label: "“Done”",
      text: "Over budget, it would instead give you a link to pay yourself, or to raise its budget on your account page.",
      reply: true,
    },
  ],
};

export const DOCS: Doc[] = [
  {
    slug: "poppy",
    title: "Poppy (PAP 1.0)",
    short: "How an agent proves who it is and gets your permission.",
    intro:
      "PAP 1.0, Poppy for short, is how an agent tells a store who it is. Its `client_id` is a URL on its own site. The store reads the agent's name and public keys there, and the agent signs each token request with its private key, so nobody else can sign in under its name.",
    actors: [
      { id: "you", label: "You" },
      { id: "agent", label: "Agent" },
      { id: "site", label: "Agent's site" },
      { id: "store", label: "Atelier Velune" },
    ],
    steps: [
      {
        from: "agent",
        to: "store",
        label: "GET /.well-known/poppy.json",
        text: "The store's PAP document: where to sign in, the MCP and OpenAPI interfaces, each scope and what still works without it, and the tasks endpoint.",
      },
      {
        from: "agent",
        to: "store",
        label: "GET /oauth/authorize",
        text: "The agent opens the sign-in in your browser with its `client_id` URL, the scopes it wants and a PKCE S256 challenge. A PAP agent must name its scopes.",
      },
      {
        from: "store",
        to: "site",
        label: "GET client_id document",
        text: "The store reads the agent's name, redirect URIs and `jwks_uri` from that URL. It fetches only public addresses.",
      },
      {
        from: "store",
        to: "you",
        label: "Consent page",
        text: "You sign in, see the agent's name and what it may do, choose a budget, then Allow or Deny.",
      },
      {
        from: "you",
        to: "agent",
        label: "Redirect with a code",
        text: "Your browser goes back to the agent's redirect URI with a one-time code.",
      },
      {
        from: "agent",
        to: "store",
        label: "POST /oauth/token",
        text: "The agent trades the code for tokens. It sends the PKCE verifier and a short JWT signed with its private key (`private_key_jwt`).",
      },
      {
        from: "store",
        to: "site",
        label: "GET jwks_uri",
        text: "The store checks the signature against the agent's published keys and refuses an assertion it has already seen.",
      },
      {
        from: "store",
        to: "agent",
        label: "Access and refresh tokens",
        text: "They carry only what you allowed. You can lower the budget or disconnect the agent from your account at any time.",
        reply: true,
      },
      {
        from: "agent",
        to: "store",
        label: "GET /poppy/tasks",
        text: "What agents cannot do here (create an account, save a card, change a budget, refunds) and the way around it when there is one. `POST /poppy/feedback` reports a task that failed.",
      },
    ],
    notes: [
      {
        title: "Shopping without signing you in",
        body: [
          "A PAP agent can also send a signed `Poppy-Session` header. With a valid one it may shop over `/mcp` as a guest: it builds a checkout and pays with its own network token, or hands the checkout to you.",
        ],
      },
      {
        title: "Agents without a browser",
        body: [
          "An agent that cannot receive the redirect asks `/oauth/device_authorization` for an 8-letter code and shows it to you. You type it at `/device`, see the same consent page, and the agent picks up its tokens by asking `/oauth/token` every 5 seconds. The code lasts 10 minutes.",
        ],
      },
    ],
    tries: [
      { method: "GET", path: "/.well-known/poppy.json", label: "GET /.well-known/poppy.json" },
      AUTH_SERVER,
    ],
    channels: ["oauth", "pap"],
  },
  {
    slug: "mcp",
    title: "MCP",
    short: "The tool server a chat assistant such as ChatGPT connects to.",
    intro:
      "MCP is how chat assistants call tools on a remote server. This store's server is `/mcp`, over Streamable HTTP. Every tool needs your permission, so the assistant's first call is refused with a pointer to the sign-in.",
    actors: [
      { id: "you", label: "You" },
      { id: "host", label: "Assistant" },
      { id: "store", label: "Atelier Velune" },
      { id: "adyen", label: "Adyen TEST" },
    ],
    steps: [
      {
        from: "host",
        to: "store",
        label: "POST /mcp initialize",
        text: "The assistant connects with no token yet.",
      },
      {
        from: "store",
        to: "host",
        label: "401 + WWW-Authenticate",
        text: "The answer names `resource_metadata`: the document that says who protects `/mcp`.",
        reply: true,
      },
      {
        from: "host",
        to: "store",
        label: "GET OAuth metadata",
        text: "`/.well-known/oauth-protected-resource/mcp`, then `/.well-known/oauth-authorization-server`: the sign-in and token endpoints.",
      },
      {
        from: "host",
        to: "you",
        label: "Sign in and allow",
        text: "OAuth with PKCE S256, as on the Poppy page. You choose what it may do and its budget.",
      },
      {
        from: "host",
        to: "store",
        label: "tools/list (Bearer)",
        text: "Now with its token: `search_catalog`, `lookup_catalog`, `get_product`, `create_cart`, `update_cart`, `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout` and `get_order`.",
      },
      {
        from: "host",
        to: "store",
        label: "tools/call search_catalog",
        text: "Products with their colours, sizes and variant ids.",
      },
      {
        from: "host",
        to: "store",
        label: "tools/call create_checkout",
        text: "With line items. The answer lists your saved cards as instruments and `agent_budget`: limit, spent, remaining and `manage_url`.",
      },
      {
        from: "host",
        to: "store",
        label: "tools/call complete_checkout",
        text: "Names a saved card. The store checks the total against what is left of the budget.",
      },
      {
        from: "store",
        to: "adyen",
        label: "POST /payments",
        text: "A merchant-initiated payment with the stored card (`ContAuth`, `UnscheduledCardOnFile`).",
      },
      {
        from: "adyen",
        to: "store",
        label: "Authorised",
        text: "Adyen's answer. A refusal ends this attempt, not the checkout.",
        reply: true,
      },
      {
        from: "store",
        to: "host",
        label: "Order placed",
        text: "The order, and the budget after this charge.",
        reply: true,
      },
    ],
    notes: [
      {
        title: "When the budget is not enough",
        body: [
          "`complete_checkout` then answers `requires_escalation` with two links: `continue_url`, where you review and pay yourself, and `manage_url`, your account page at that agent, where you can raise its budget after confirming with your password or a passkey. The agent then completes again on the same sign-in.",
        ],
      },
      {
        title: "What your assistant needs",
        body: [
          "Remote MCP over Streamable HTTP, OAuth sign-in from the `401` challenge, and a sign-in callback your browser can reach. A host without one uses the device code at `/device`.",
          "Any MCP client may register itself at `/oauth/register` (RFC 7591) and get a public `client_id` with no secret; PKCE proves its sign-in. A PAP agent uses its metadata URL as `client_id` instead and signs its token requests.",
        ],
      },
    ],
    tries: [TOOLS_LIST, AUTH_SERVER],
    channels: ["mcp", "oauth"],
  },
  {
    slug: "webmcp",
    title: "WebMCP",
    short: "Tools this site offers to an agent running inside your browser.",
    intro:
      "WebMCP lets an agent built into your browser use tools that the page itself offers, through `document.modelContext` (a W3C draft; Chrome's origin trial, or `chrome://flags/#enable-webmcp-testing`). The tools do what the buttons do, and none of them pays.",
    actors: [
      { id: "you", label: "You" },
      { id: "agent", label: "Browser agent" },
      { id: "page", label: "This page" },
      { id: "store", label: "Atelier Velune" },
    ],
    steps: [
      {
        from: "page",
        to: "agent",
        label: "Register 5 tools",
        text: "`search_catalog` and `view_cart` (read-only), `add_to_cart`, `update_cart_item` and `start_checkout`, each with an input and output schema. Account, consent, device and Back Office pages register none.",
      },
      {
        from: "you",
        to: "agent",
        label: "“Add the shirt in M”",
        text: "You ask the agent in your browser.",
      },
      {
        from: "agent",
        to: "page",
        label: "search_catalog",
        text: "The page reads the catalogue as the shop page does.",
      },
      {
        from: "page",
        to: "store",
        label: "GET /api/catalog",
        text: "A read-only call; it changes nothing.",
      },
      {
        from: "agent",
        to: "page",
        label: "add_to_cart",
        text: "A product in a colour and size goes into your cart on this site, as the button would do it.",
      },
      {
        from: "agent",
        to: "page",
        label: "start_checkout",
        text: "The page creates the checkout and opens the checkout page.",
      },
      {
        from: "page",
        to: "store",
        label: "POST /api/checkouts",
        text: "The same call as the cart page's button.",
      },
      {
        from: "you",
        to: "page",
        label: "Pay in Drop-in",
        text: "You pay yourself on the checkout page; the agent never pays here.",
      },
    ],
    notes: [
      {
        title: "Separate from /mcp",
        body: [
          "WebMCP needs no sign-in or token: it acts in your browser, with your cart. A remote assistant uses `/mcp` instead.",
        ],
      },
    ],
    tries: [],
    channels: ["web"],
  },
  {
    slug: "ucp",
    title: "UCP",
    short: "The shopping API: catalogue, carts, checkouts, orders and payment handlers.",
    intro:
      "UCP is the shopping protocol itself. A profile says what the store supports; carts, checkouts and orders follow over REST at `/ucp/v1`, and the MCP tools run the same code. Payment goes through the handlers the profile declares.",
    actors: [
      { id: "agent", label: "Agent" },
      { id: "store", label: "Atelier Velune" },
      { id: "adyen", label: "Adyen TEST" },
      { id: "you", label: "You" },
    ],
    steps: [
      {
        from: "agent",
        to: "store",
        label: "GET /.well-known/ucp",
        text: "The profile: UCP version 2026-08-25, its capabilities and two payment handlers, `saved_card` and `network_token`.",
      },
      {
        from: "agent",
        to: "store",
        label: "POST /checkout-sessions",
        text: "Line items with variant ids. The store prices them in EUR minor units and answers with a status.",
      },
      {
        from: "agent",
        to: "store",
        label: "PUT /checkout-sessions/{id}",
        text: "Changes lines or the buyer. With lines, a buyer email and payments configured, the status becomes `ready_for_complete`.",
      },
      {
        from: "agent",
        to: "store",
        label: "POST …/{id}/complete",
        text: "With an instrument: a saved card (signed in, `ucp:pay`) or a network token (signed in or guest). Or with none, to hand the checkout to you.",
      },
      {
        from: "store",
        to: "adyen",
        label: "POST /payments",
        text: "For a network token, `POST /cardDetails` first gives its brand. Both are merchant-initiated.",
      },
      {
        from: "store",
        to: "agent",
        label: "completed or requires_escalation",
        text: "Completed with an order, or `requires_escalation` with a `continue_url` for you.",
        reply: true,
      },
      {
        from: "you",
        to: "store",
        label: "Open continue_url",
        text: "You review the checkout and pay with Drop-in. Your payment never counts against the agent's budget.",
      },
    ],
    notes: [
      {
        id: "saved-card-handler",
        title: "Payment handler saved_card",
        body: [
          "Declared as `com.payments-playground.saved_card`. Its instruments are aliases of the cards saved with Adyen by the account that approved the agent; the Adyen token never leaves the store. It needs the `ucp:pay` scope and a total within what is left of the agent's budget.",
          "A signed-in agent's checkout carries `agent_budget`: `spend_limit`, `spent`, `remaining` and `manage_url`. Over the limit the checkout is `requires_escalation`: you pay at `continue_url`, or raise the limit at `manage_url` with your password or a passkey, and the agent completes again.",
        ],
      },
      {
        id: "network-token-handler",
        title: "Payment handler network_token",
        body: [
          "Declared as `com.payments-playground.network_token`, schema `/ucp/v1/handlers/network_token.json`. The credential is the token's number and expiry, with an optional holder name: no cryptogram, no CVC, no brand. The store asks Adyen for the brand (`/cardDetails`), pays once as a `networkToken` payment (`ContAuth`, `UnscheduledCardOnFile`), and never stores, logs or returns it.",
          "A guest agent may use it; a signed-in agent stays within its budget. Adyen must enable network-token payments on the merchant account.",
        ],
      },
      {
        title: "Scopes",
        body: [
          "`dev.ucp.shopping.cart:manage` fills a cart, `dev.ucp.shopping.checkout:manage` checks out with your delivery address, `ucp:pay` pays with your saved card within the budget, `dev.ucp.shopping.order:read` reads the orders the agent placed, `profile` reads your name and email. Over REST the catalogue, carts and checkouts also work without a token; a token that is sent must carry the operation's scope, or the answer is `403` naming it.",
        ],
      },
    ],
    tries: [{ method: "GET", path: "/.well-known/ucp", label: "GET /.well-known/ucp" }],
    channels: ["ucp-rest"],
  },
  {
    slug: "adyen",
    title: "Adyen",
    short: "Which Adyen TEST calls run when you or an agent pays.",
    intro:
      "Every payment here runs on Adyen TEST, so no real money moves. The store calls Checkout API v72 from its server with its own key; your browser talks to Adyen only through Drop-in.",
    actors: [
      { id: "you", label: "You (Drop-in)" },
      { id: "store", label: "Atelier Velune" },
      { id: "adyen", label: "Adyen TEST" },
      { id: "agent", label: "Agent" },
    ],
    steps: [
      {
        from: "store",
        to: "adyen",
        label: "POST /sessions",
        text: "You pay, or save a card from your account: the store opens a Drop-in session. Saving a card is a zero-value check that stores it for later merchant-initiated payments.",
      },
      {
        from: "you",
        to: "adyen",
        label: "Card details",
        text: "Drop-in sends the card straight to Adyen. Its number never reaches the store.",
      },
      {
        from: "store",
        to: "adyen",
        label: "GET /sessions/{id}",
        text: "The session's result once Drop-in finishes.",
      },
      {
        from: "store",
        to: "adyen",
        label: "GET /storedPaymentMethods",
        text: "Your saved cards, by your shopper reference. Agents see only aliases of them.",
      },
      {
        from: "agent",
        to: "store",
        label: "complete_checkout",
        text: "An agent pays with one of your saved cards, or its own network token.",
      },
      {
        from: "store",
        to: "adyen",
        label: "POST /cardDetails",
        text: "Only for a network token: Adyen reads its brand from the number.",
      },
      {
        from: "store",
        to: "adyen",
        label: "POST /payments",
        text: "`ContAuth` and `UnscheduledCardOnFile`: the shopper is not there, the card is on file or tokenised.",
      },
      {
        from: "adyen",
        to: "store",
        label: "Webhook AUTHORISATION",
        text: "Checked against its HMAC signature before it counts. It settles a payment whose answer was still pending.",
        reply: true,
      },
    ],
    notes: [
      {
        title: "What an order trusts",
        body: [
          "An order's state comes from Adyen's answers and HMAC-valid webhooks, never from the browser. A refused payment ends that attempt; the checkout stays open for another.",
        ],
      },
    ],
    tries: [],
    channels: ["adyen", "webhook"],
  },
  {
    slug: "chatgpt",
    title: "ChatGPT app",
    short:
      "The store's carousel and bag inside the conversation: tap to shop, or ask the assistant.",
    intro:
      "Hosts that show MCP Apps, ChatGPT among them, draw this store's own carousel and bag in the chat. You shop in them with a tap, or ask the assistant in the chat to shop for you. Either way the assistant's sign-in and budget decide what can happen, and the widget never sees your card.",
    actors: [
      { id: "you", label: "You" },
      { id: "host", label: "ChatGPT" },
      { id: "widget", label: "Store widget" },
      { id: "store", label: "Atelier Velune" },
      { id: "adyen", label: "Adyen TEST" },
    ],
    steps: [
      {
        from: "you",
        to: "host",
        label: "Find me a trench coat",
        text: "You ask in the chat, after connecting the store once (below).",
      },
      {
        from: "host",
        to: "store",
        label: "tools/call search_catalog",
        text: "With your sign-in token. The tool's `_meta.ui.resourceUri` names `ui://widget/product-carousel-v2.html`.",
      },
      {
        from: "store",
        to: "host",
        label: "UCP products",
        text: "The same UCP answer every agent gets, in `structuredContent`.",
        reply: true,
      },
      {
        from: "host",
        to: "store",
        label: "resources/read",
        text: "The carousel's page, `text/html;profile=mcp-app`. ChatGPT runs it in a sandboxed frame that may load images from this store and nothing else.",
      },
      {
        from: "host",
        to: "widget",
        label: "tool-result",
        text: "The carousel shows the products with their colours and sizes.",
      },
      {
        from: "you",
        to: "widget",
        label: "Add to bag",
        text: "You pick a colour and a size and tap Add to bag.",
      },
      {
        from: "widget",
        to: "host",
        label: "tools/call create_cart",
        text: "The widget holds no token: it asks ChatGPT to run the tool, on the same sign-in and with the same checks as when the assistant calls it.",
      },
      {
        from: "host",
        to: "store",
        label: "create_cart, then create_checkout",
        text: "Checkout lists the cards saved in your account that this assistant may use: brand, last four digits and expiry only.",
      },
      {
        from: "widget",
        to: "host",
        label: "tools/call complete_checkout",
        text: "You tap Pay. `complete_checkout` is marked destructive, so ChatGPT may ask you to confirm before it runs.",
      },
      {
        from: "store",
        to: "adyen",
        label: "POST /payments (stored card)",
        text: "Within the budget you set when connecting; over it, the bag offers to approve on the store or raise the budget there.",
      },
      {
        from: "adyen",
        to: "store",
        label: "Authorised",
        text: "Adyen TEST answers; no real money moves.",
        reply: true,
      },
      {
        from: "host",
        to: "widget",
        label: "Paid, order placed",
        text: "The bag shows the order with a link to it on this store.",
        reply: true,
      },
    ],
    notes: [
      {
        title: "Shopping in the widget",
        body: [
          "The carousel and the bag are a small shop. Search, page through, pick colour and size, change quantities, check out and pay, all in the widget. It tells the assistant what changed, so the chat keeps the same cart.",
          "To let the assistant do it instead, ask in the chat: it calls the same tools, with the same sign-in and checks. The widget's buttons never write in the chat.",
        ],
      },
      {
        id: "connect",
        title: "Connect ChatGPT",
        body: [
          "To get the carousel, bag and built-in stylist instructions in ChatGPT right away, add a custom MCP server with this store's `/mcp` address (on the Agents page) and OAuth. In `chatgpt.com/plugins`, click `+` and choose Add custom MCP server (or look in Settings, Apps & Connectors, Advanced and Developer mode). Use Refresh on that connector after store updates.",
          "When the store asks, sign in, keep Pay with your saved card, and set a budget above what you will buy. Saving a test card in your account under Payment methods lets the bag pay directly in chat.",
        ],
      },
      {
        title: "What the widget cannot do",
        body: [
          "Read your card, enter a new one, or pay with a card the checkout did not list. Raise its own budget: over it, the store's own page asks for your password or a passkey. Reach any site but this store.",
        ],
      },
      {
        id: "plugin",
        title: "The plugin package",
        body: [
          "`atelier-velune-plugin.zip` holds `plugin.json`, `mcp.json` (with the Agent Plugins `$schema`, this store's `/mcp` address and OpenAI OAuth CIMD settings), the personal-stylist skill and icons. Use it on `platform.openai.com/plugins` (With MCP, then MCPs -> Connect) or install it in Codex; importing a ZIP directly in `chatgpt.com/plugins` loads only the skill without connecting MCP.",
        ],
      },
    ],
    tries: [TOOLS_LIST],
    channels: ["mcp"],
  },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);

---
type: Component
title: "adyen-agentic-commerce: a store any AI agent can buy from, paid on Adyen TEST"
description: "Bun app (Next.js 16, Elysia, Eden): a fashion store over UCP 2026-08-25 (REST and MCP) behind PAP 1.0 sign-in, with customer accounts, Drop-in checkout, and agent payments on a saved card or a one-time network token, on Adyen TEST."
tags: [component, agentic, pap, ucp, mcp, checkout, bun]
status: draft
scope: component-adyen-agentic-commerce
generated:
  by: antigravity/gemini
  at: 2026-11-25T15:00:00Z
verified:
  - at: 2026-11-19
    check: "v0.7.1 on develop: bun run check green (413 agentic tests, 107 workspace tests, biome ci 0 errors, tsc clean, 3 Next builds + SSR, template-tests PASS); bridge dedup, silent setWidgetState, /api/return, MCP prompts and OpenAI ZIP schema tested."
  - at: 2026-11-18
    check: "v0.7.0 on develop: bun run check green; 26 new tests (resources, tool _meta, ZIP, widget logic). Stand-in host in a browser, under the host CSP: MCP Apps and window.openai bridges, both modes, search to saved-card payment, over-budget links, 375 and 1440 px, light and dark. Not yet in ChatGPT."
  - at: 2026-11-18
    check: "v0.6.0 on develop: bun run check green, 379 agentic tests (budget, ucp-rest filter, email masking tests fail before). Localhost browser: consent, account, Back Office, Docs at 375 and 1440 px, light and dark; no page-wide scroll; a stale limit opened the step-up."
sources:
  - id: app
    resource: ../../apps/adyen-agentic-commerce
    title: "The Bun app: Next.js pages, Elysia API, server modules"
  - id: package
    resource: ../../apps/adyen-agentic-commerce/package.json
    title: Exact dependency pins and scripts
  - id: next-config
    resource: ../../apps/adyen-agentic-commerce/next.config.ts
    title: "Standalone output; no rewrites: route files re-export the Elysia handler at the public paths"
  - id: src
    resource: ../../apps/adyen-agentic-commerce/src
    title: "Pages (app/), API (app/api), server modules (server/: api.ts and protocol.ts at the top, one folder per domain: core, payments, catalog, commerce, accounts, oauth, ucp, mcp, pap, back-office, ask; oauth.ts and commerce.ts re-export their folder's files, one per responsibility)"
  - id: widgets
    resource: ../../apps/adyen-agentic-commerce/src/widgets
    title: "MCP Apps widgets (carousel, bag), their bridge and logic"
  - id: plugin
    resource: ../../apps/adyen-agentic-commerce/plugin/atelier-velune
    title: "The plugin package served as a ZIP"
---

# adyen-agentic-commerce

## Intent

A demo store (clothes, bags, accessories; fictional brand, original SVG product art) that a shopper
can use directly and that **any MCP-capable LLM** can shop on their behalf from the site address
alone. It shows merchants the full chain: discovery (PAP 1.0), catalogue, cart and checkout (UCP
2026-08-25 over REST and MCP), sign-in with a spend limit, and a **real Adyen TEST payment** that
appears in the Customer Area. Owner decision 2026-11-15: Bun + Elysia + Eden + Next.js replace the
Fresh app ([ADR-012](../decisions/ADR-012-agentic-app-on-bun-and-next.md)).

Owner decision 2026-11-17 ([ADR-015](../decisions/ADR-015-customer-accounts-and-agent-network-tokens.md)):
a person opens a **customer account** (email and password, passkeys) and the agents they approve
act for that account, with its saved cards and within the limit they set. The two channels stay
apart and labelled: `web` (the pages and `/api`, paid in Drop-in) and `agent` (UCP REST and MCP).
An agent may also **bring its own card as a network token** (number and expiry), signed in or as
a guest, or hand the checkout to the shopper, who pays at `continue_url`.

## Data sources

| Source                                    | What is read                                                   | Owner | Freshness           |
| ----------------------------------------- | -------------------------------------------------------------- | ----- | ------------------- |
| `src/server/catalog/catalog.ts`                   | Products, variants (colour, size), prices in EUR minor units   | Repo  | Shipped with build  |
| SQLite (`DATABASE_PATH`, `bun:sqlite`)    | Carts, checkouts, orders, OAuth clients/codes/tokens, grants,  | App   | Per request         |
|                                           | seen JWT ids, idempotency records, protocol trace, webhooks,   |       |                     |
|                                           | customers, customer sessions, passkeys, WebAuthn challenges,   |       |                     |
|                                           | the Ask agent's records ([ask-agent](ask-agent.md))            |       |                     |
| Adyen Checkout API v72 TEST               | `/sessions`, `/payments` (stored card or network token), the   | Adyen | Per call            |
|                                           | stored payment methods of each account's `shopperReference`,   |       |                     |
|                                           | a network token's brand (`/cardDetails`)                       |       |                     |
| Adyen standard webhooks (HMAC)            | `AUTHORISATION` and other event codes                          | Adyen | Asynchronous        |
| Agent client metadata document + jwks_uri | `client_id`, `redirect_uris`, `jwks_uri`, public keys          | Agent | Cached 5 min        |
| Platform profile named by `UCP-Agent`     | `ucp.version`, `ucp.capabilities`                              | Agent | Cached per URL      |
| `.env` (never read by tooling or agents)  | `ADYEN_API_KEY`, `ADYEN_MERCHANT_ACCOUNT`, `ADYEN_CLIENT_KEY`, | Owner | Boot                |
|                                           | `ADYEN_HMAC_KEY`, `PUBLIC_ORIGIN`, `DATABASE_PATH`, `PORT`     |       |                     |
| Deploy variable (public, optional)        | `WEBMCP_ORIGIN_TRIAL_TOKEN`, sent as `Origin-Trial` on pages   | Owner | Per request         |

From v0.3.2 the Render Blueprint sets `DATABASE_PATH=/var/data/agentic.sqlite` on a 1 GB disk;
before, every deploy or restart emptied orders, agents and grants.

## Inputs

- **Shopper (browser):** catalogue filters, variant choice, cart edits, shipping details, Drop-in
  (Sessions flow), consent decisions, spend limit, agent revocation, card save (zero-value auth).
  A guest buys without an account; consent, device approval, the account and card save need one.
  The consent page, where both sign-in flows end, tells the shopper in one sentence to allow only
  if they just asked this agent to connect (PAP 1.0 §10.8: a link or code can be sent by someone
  else). It is a short e-commerce screen: the agent's name, the account (email masked), one line
  per permission, a budget with presets (50, 150, 300, 1000 EUR) and a free amount, Allow and Deny;
  the client's host and where the browser returns sit in a folded "Details".
- **Customer account (browser):** sign-up `POST /api/customers` (email, name, a password of 12 to
  128 characters), sign-in `POST /api/session` (email and password), sign-out `DELETE
  /api/session`; passkeys: `POST /api/passkeys/register/options` and `/register/verify` while
  signed in, `POST /api/passkeys/login/options` and `/login/verify` to sign in, `DELETE
  /api/passkeys/:id`. The session is a cookie, `__Host-velune_session` on https (`velune_session`
  on a loopback http origin, where browsers keep no `__Host-` cookie). Passkeys use the public
  origin's host as RP ID; WebAuthn takes no IP address, so a loopback run uses `localhost` and
  passkeys work there only when the store is opened at `http://localhost:<port>`. The browser API
  reads no bearer token: an agent's token there binds nothing to an account.
- **Agent's network token:** `complete_checkout` may carry an instrument with `handler_id`
  `network_token`, `type` `card` and a credential of `type` `network_token`: `number` (13 to 19
  digits), `expiry_month` (1 to 12), `expiry_year` (four digits, not past), optional `name`. No
  cryptogram, CVC or brand (owner decision 2026-11-17); any other field is ignored. A guest agent
  may send one; a signed-in agent needs the checkout scope and stays within its grant's remaining
  limit. An agent may instead complete with an empty `payment.instruments` (or no `payment`), which
  hands the checkout to the shopper; an instrument that names nothing usable is a 400.
- **Agent (HTTP):** UCP REST under `/ucp/v1` with `UCP-Agent: profile="<url>"`, `Request-Id`, and
  `Idempotency-Key` (UUID) on every mutation; MCP JSON-RPC 2.0 at `POST /mcp` with
  `meta["ucp-agent"].profile` and `meta["idempotency-key"]` (optional in MCP, honoured when sent);
  OAuth 2 (authorization code + PKCE S256; `private_key_jwt` for PAP clients, public clients
  registered by RFC 7591 for generic MCP clients); the device authorization grant (RFC 8628) for an
  agent whose browser cannot reach its own callback, for clients that declare it in `grant_types`;
  optional `Poppy-Session` (PAP 1.0 §5.2: `typ` `poppy-session+jwt`, ES256, the delegation in the
  JWT header's `poppy_dlg`, `aud` the issuer as one string, `htm`, `htu`, `ath`, `iat`, `jti`). A
  Session needs `Poppy-Version` 1.x; a missing one, or any other major version even without a
  Session, is `version_unsupported`. A `private_key_jwt` client assertion has one `aud` string,
  `iat` and `jti`, and lives at most 300 s; its `iat` may be at most 60 s ahead of the store's
  clock. Owner decision 2026-11-18
  ([ADR-016](../decisions/ADR-016-client-assertion-audience-for-mcp-clients.md)), against PAP 1.0
  §4.1, which allows only the issuer: that `aud` may be the issuer, the issuer with one final
  slash, or the exact token endpoint URL (RFC 7523 §3, OpenID Connect Core §9), so ChatGPT's MCP
  connector can sign in. An array or any other value is refused, and the refusal names the `aud`
  received. It may be signed with ES256, ES384, PS256, PS384, RS256 or EdDSA, as
  `token_endpoint_auth_signing_alg_values_supported` says: RFC 7523 leaves the algorithm to the
  server, and an MCP client known by its client metadata document (ChatGPT's, 2026-11-18) signs
  with none of PAP's two. Never `none` or an HMAC: the store holds only public keys. A Session's
  delegation keeps PAP's ES256 or PS384.
  REST catalogue, carts and checkouts work anonymously. `/mcp` answers 401 with the resource
  metadata URL until the agent signs in, unless the request carries a verified `Poppy-Session`:
  a PAP agent signed out gets the same guest access as on REST (PAP's UCP extension §8), and a
  generic MCP client, which sends no Session, keeps the 401. The store's own Ask agent reaches the
  same handler in-process (`handleHouseMcp`, on no route): without a token it is a guest like a
  signed-out PAP agent; with its shopper's grant token, that token is checked like any other
  ([ask-agent](ask-agent.md)). Client metadata documents must be
  https, except loopback ones while `PUBLIC_ORIGIN` is itself loopback (local runs and
  `scripts/pap-agent.ts`).
- **Outbound fetches (PAP 1.0 §3):** before fetching a URL an agent gave it (client document,
  `jwks_uri`, platform profile), the store resolves the host and refuses it when any address is
  loopback, private, link-local, unspecified, multicast, shared (`100.64.0.0/10`) or unique-local;
  loopback passes only while `PUBLIC_ORIGIN` is loopback. A client document and its key set are
  each cached 5 minutes; a signature whose key id the cached set lacks refetches the set once, at
  most once a minute per `jwks_uri`. Any failure to resolve, fetch or read them is
  `invalid_client`. A redirect URI on a loopback host (`127.0.0.1`, `[::1]`, `localhost`, plain
  http) matches the registered one with any port, for any client (RFC 8252 §7.3).
- **Platform profile (UCP negotiation):** every REST request names its profile in
  `UCP-Agent: profile="<url>"`; an MCP `tools/call` may name it in `meta["ucp-agent"].profile`
  (deviation, decided 2026-11-17: generic MCP clients send none, so a call without one runs on the
  store's own capabilities). When the header and `meta` both name one, they must be the same URL.
  The URL is https (plain http only on loopback while `PUBLIC_ORIGIN` is loopback), a host name
  rather than an IP literal, without credentials, at most 2,048 characters. The store fetches it
  without following redirects, within 5 s and 256 KiB, and checks the platform profile shape:
  `ucp.version` a date, `ucp.services` and `ucp.payment_handlers` registries, capability entries
  with `version`, `spec` and `schema`, and no private key member in `keys`. A profile is cached
  per URL for its `Cache-Control` `max-age` (at most an hour; 5 minutes without one; never with
  `no-store`), at most 1,000 at once; an entry keeps only the profile's version and the
  capabilities it shares with the store, never the profile itself. Its `ucp.version` must be
  2026-08-25. The negotiated
  capabilities are the store's and the profile's with the same name and a common version; an
  entry whose `schema` host, reversed, does not own its name is left out (UCP authority binding).
  Each operation belongs to one capability (`OP_CAPABILITY` in `src/server/ucp/ucp.ts`); it runs only
  when that capability was kept. The cheap checks (route, headers, body, Idempotency-Key) come
  before the fetch.
- **Resource indicators (RFC 8707):** `resource` on authorize, device authorization and token
  requests must be `PUBLIC_ORIGIN` (UCP REST) or `${PUBLIC_ORIGIN}/mcp`, compared after RFC 3986
  normalisation (the origin's trailing slash is the origin; a query, fragment or other path is
  not), and may repeat; at the token endpoint it must also be one the grant was issued for, and it
  is checked before a device code or refresh token is spent. A token issued for one resource is
  accepted only there (401 `invalid_token` elsewhere); a token issued without one is accepted at
  both. The refresh token always keeps what the grant gave: the resources named at authorization
  (none means both) and the approved scopes. A token request (code, device code or refresh) may
  narrow the access token to fewer resources and scopes, never the refresh token, so a later
  refresh can ask for the rest (PAP 1.0 §4.5, RFC 6749 §6). `scripts/pap-agent.ts` signs in
  without `resource`, since a PAP sign-in covers every resource, and names the MCP URL at the
  token request.
- **Scopes:** advertised under their UCP names, each with its PAP 1.0 §4.7 hint.

  | Scope                              | Lets the agent                                        | Changes      | Personal data |
  | ---------------------------------- | ----------------------------------------------------- | ------------ | ------------- |
  | `dev.ucp.shopping.cart:manage`     | create, update and cancel carts                       | reversible   | no            |
  | `dev.ucp.shopping.checkout:manage` | create, update, complete and cancel checkouts         | reversible   | yes (address) |
  | `ucp:pay`                          | pay with the account's saved card within the limit    | irreversible | yes (card)    |
  | `dev.ucp.shopping.order:read`      | read the orders it placed for the account             | none         | yes           |
  | `profile`                          | read the account's name and email                     | none         | yes           |

  The consent page shows each line above in words: the label, a pill for the change ("Read only",
  "Can be undone", "Can't be undone") and a mark when the agent sees personal data, never the scope
  name; `poppy.json` and the OpenAPI flows add, for agents,
  whether the task works without the scope (PAP 1.0 §4.7): guest carts and checkouts need none,
  and a network token or the shopper at `continue_url` pays without `ucp:pay`.
  The earlier names stay accepted, never advertised: `ucp:checkout` stands for the cart and
  checkout scopes, `ucp:orders` for `dev.ucp.shopping.order:read`. A token keeps the names it was
  issued with. A PAP agent (a URL `client_id` with `private_key_jwt`) must send `scope` in each
  sign-in request (PAP 1.0 §4.7), or gets `invalid_scope`; any other client that sends none,
  registered or a public URL client, is offered the cart, checkout and pay scopes (RFC 6749 §3.3
  allows a default). Decided 2026-11-17, delegated by the owner.
- **Device sign-in:** `POST /oauth/device_authorization` returns a device code, an 8-letter user
  code (`BCDF-GHJK` alphabet, RFC 8628 §6.1), `/device` as the verification URI, 600 s and a 5 s
  interval. The shopper types the code at `/device`, then sees the same consent page. A client
  whose `client_id` is a URL must sign its device requests (`private_key_jwt`): with no callback on
  its host, a public one could be started by anyone and shown as that host.
- **Agent in the shopper's browser (WebMCP):** when the browser exposes `document.modelContext`
  (W3C draft; Chrome origin trial, or the `#enable-webmcp-testing` flag), the shopping pages
  register `search_catalog` and `view_cart` (read-only), `add_to_cart`, `update_cart_item` and
  `start_checkout` (`src/lib/webmcp.ts`), each with an `inputSchema` and an `outputSchema`
  describing what it returns. They read the read-only `GET /api/catalog` and write the
  same cart and `POST /api/checkouts` as the buttons; `start_checkout` opens the checkout page,
  where the shopper pays in Drop-in. This is separate from `/mcp`, which is unchanged.
- **Shopper in an agent host's UI (MCP Apps, [ADR-017](../decisions/ADR-017-mcp-apps-ui-on-the-ucp-server.md)):**
  a host that renders MCP Apps (ChatGPT, Claude) shows the product carousel or the bag inside the
  conversation. The shopper picks a mode in it: "By hand", where its buttons call the UCP tools
  through the host (search, next page, add to bag, quantities, checkout, pay with a listed saved
  card), or "With the assistant", where the same buttons only send the assistant a sentence and the
  assistant calls the tools. Either way every call is the host's `tools/call` on the shopper's
  grant; the widget holds no token and no card data, and from the host's first message on it posts to
  the host's origin only (keeping `"*"` for the handshake and for an opaque `"null"` host origin).
  It shows the store's refusals in its own plain words for the codes it knows, and the store's
  text for any other.
- **Catalogue:** UCP's `filters.categories` (any of the listed ones) and `filters.price` (`min`,
  `max`, minor units) on search, lookup and product; the singular `category` this store read
  before stays accepted. Search pages with `pagination.limit` (10 by default, at most 50) and the
  opaque `pagination.cursor` it returned. Lookup takes at most 50 distinct ids. Product takes
  `selected` options and `preferences`, option names in priority order: when no variant matches
  them all, the last one is dropped first (UCP keeps the higher-priority selections).
- **Cart to checkout:** a create-checkout request with `cart_id` takes the cart's lines and buyer
  (UCP 2026-08-25 cart extension); its own `line_items`, and its `buyer` when the cart has one, are
  ignored, not parsed (`src/server/ucp/ucp.test.ts` "cart to checkout").
- **Amounts:** integers in EUR minor units, computed by the server from the catalogue. An agent
  never sends a price; any client-sent price or total is ignored.

## Outputs

- **Discovery:** `/.well-known/poppy.json`, `/.well-known/oauth-protected-resource` (and
  `/.well-known/oauth-protected-resource/mcp`), `/.well-known/oauth-authorization-server`,
  `/.well-known/ucp`. `poppy.json` gives `auth.scopes` as a map of scope to description and
  `auth.scope_hints` keyed by scope with both `changes` and `personal_data` (PAP 1.0 §3.1, §4.7),
  `tasks.endpoint`, and an MCP description that names the three ways to pay (saved card, the
  agent's network token, the shopper at `continue_url`). The UCP profile lists `dev.ucp.common.identity_linking` with `config.scopes` holding only
  `dev.ucp.shopping.order:read`, the one hard gate (an order placed through a linked agent); the
  other scopes are the optional layer in `scopes_supported`. `/ucp/v1/openapi.json` names every
  operation by its UCP `operationId`, refers to the UCP 2026-08-25 schemas, declares per operation
  whether a token is optional and which scope it needs, and lists the error statuses with examples.
  `/.well-known/ucp`, `/ucp/v1/openapi.json` and `/ucp/v1/handlers/saved_card.json` are published
  artifacts: `Cache-Control: public, max-age=300` and an `ETag` (304 on a matching
  `If-None-Match`, compared weakly as RFC 9110 says, since Render's edge sends the ETag back as
  `W/"…"`), never a redirect. Every other answer is `no-store`.
- **UCP catalogue:** products and variants carry `description: {plain}`. Search returns
  `pagination {has_next_page, cursor when there is a next page, total_count}`. A lookup variant
  appears only with its `inputs`: `exact` for a variant id, `featured` (the product's first
  available variant, else its first) for a product id; each product appears once; an unknown id is
  an `info` `not_found` message whose content is the id, still 200. Product returns the requested
  variant first, `selected` (that variant's options, the featured one's, or the asked ones after
  dropping options by `preferences`), the variants matching it, and `options` whose values carry
  `available` and `exists` against `selected`; an unknown id is 200 with `ucp.status` `error` and
  `not_found`.
- **UCP orders:** `fulfillment {expectations: [], events: []}` (nothing ships in this demo) and per
  line `quantity {original, total, fulfilled: 0}` with `status: processing`.
- **UCP:** Checkout statuses `incomplete`, `requires_escalation` (with `continue_url`),
  `ready_for_complete`, `complete_in_progress`, `completed` (with `order {id, permalink_url}`),
  `canceled`; `totals` with exactly one `subtotal` and one `total`; `messages` with
  `type/code/content/severity`.
- **Payment handlers:** the profile and every UCP answer list two, `saved_card`
  (`com.payments-playground.saved_card`) and `network_token`
  (`com.payments-playground.network_token`, schema `/ucp/v1/handlers/network_token.json`, a
  published artifact like the others).
- **Payment:** a signed-in agent with `ucp:pay` within the spend limit pays with one of its
  account's saved cards: `/payments` with `storedPaymentMethodId`, `shopperInteraction: ContAuth`,
  `recurringProcessingModel: UnscheduledCardOnFile`, the account's `shopperReference`. For an
  agent's network token the store first asks Adyen `POST /cardDetails` (the number only) and takes
  the first brand Adyen supports, only for a checkout that could be paid at that moment; then
  `/payments` with `paymentMethod {type: networkToken, brand, number, expiryMonth, expiryYear,
  holderName}`, `shopperInteraction: ContAuth`, `recurringProcessingModel:
  UnscheduledCardOnFile`, no `shopperReference` and no stored-payment field. Either way the
  idempotency key is bound to the checkout attempt and the metadata carries `channel: agent`. A
  signed-in agent over its limit gets `requires_escalation`, and the shopper pays or approves at
  `continue_url`; the `spend_limit_exceeded` message also names `manage_url`. A signed-in agent's
  checkout carries `agent_budget` {`spend_limit`, `spent`, `remaining`, `manage_url`}, read from
  the grant when the answer is built; `complete_checkout` judges and renders its status from that
  same re-read grant, so the status and `agent_budget` agree when the limit changed during the
  request; `manage_url` is `/account#agent-<grant id>`, which opens the
  account page on that agent. Only the account's signed-in shopper changes the limit there, from 0
  to 1000 EUR as at consent (a value that is not a number is stored as 0); raising it needs the account password or one of its passkeys again
  (owner, 2026-11-18), lowering it or disconnecting does not, and a disconnected agent's limit no
  longer changes (409). A change the account page took for a lowering, on a limit read before
  another tab changed it, gets `confirmation_required` and opens the same password or passkey form.
  Adding a passkey needs the same proof, since a passkey can confirm a raise.
  The account page names the limit as a total that includes what was spent, shows what a typed
  limit would leave the agent, adds 50, 100 or 300 EUR to it on a tap, saves on the keyboard's OK
  any total to the cent (the form skips the browser's step check), keeps Save off while unchanged, and says what the agent can spend after a save: a
  shopper who typed the current limit to "raise" it saw nothing happen (owner, 2026-11-25;
  `src/lib/budget.test.tsx`).
  The cap applies when a limit is written: a limit set above 1000 EUR before v0.5.3 stays until the
  shopper changes it. The change applies to the agent's next payment attempt on the same grant,
  keeps what was spent and needs no new sign-in; a payment the shopper makes at `continue_url`
  never counts against the agent's limit. An agent that completes with no instrument hands the checkout over: from then on
  agents see it `requires_escalation` (`shopper_pays`) and the shopper pays at `continue_url` in
  Drop-in. A checkout whose only missing detail is the receipt's email (an agent shopping as a
  guest) asks for it there: `POST /api/checkouts/:id/email` `{ email }` fills that gap once, never
  replaces an email already set or an account's, and answers 404 for another account's checkout
  (`src/server/accounts/customers.test.ts`, "takes one at its link, once").
- **Checkout status for an agent:** with lines, a buyer email and payments configured, a guest's
  checkout is `ready_for_complete` (it may pay with a network token) and a signed-in agent's is
  too while the total fits its remaining limit, unless it was handed to the shopper; `payment.instruments` lists the account's saved
  cards when the token has `ucp:pay`.
- **Channels:** every checkout, payment and order records `channel` (`web` or `agent`), the
  account (`customerId`) when there is one, and for an agent the client; records made before
  v0.4.0 read as `agent` when an agent made them, else `web`. UCP and MCP never reach a `web`
  checkout (404), one made by the shopper's browser before v0.4.0 included, and an agent reads a cart, checkout or order only for its own client and account.
- **Back Office:** `/back-office` with tabs in the URL (`?tab=`): Overview (counts of orders,
  payments Authorised and refused, connected agents, webhooks, the last server error (5xx), the
  latest ten events), Orders, Payments, Agents (every grant: agent, account, permissions in words, limit,
  spent, remaining, state, last use), Log and Webhooks. Lists are pages of 25 (`?page=`, Log also
  50 or 100 with `?per=`) with a pager; a page past the last shows the last, anything not a
  positive integer reads as 1. Log filters: channel, actor, status class (`2xx`, `4xx`, `5xx`),
  path text and reference; each entry opens its redacted detail. An order opens its timeline: the
  trace entries that name it, its checkout or its payments, oldest first. Because the Back Office is public when
  the playground's basic auth is unset (as on Render), every email in it is masked (first letter,
  `•••`, domain). `GET /api/back-office` keeps its fields and takes `page`, `per`, the same filters
  and `channel`; its `trace` is the requested page, with `trace_total` and `trace_pages`.
- **Docs:** `/docs` explains, with diagrams drawn in SVG from the theme's tokens, how an agent
  finds and uses the store: PAP 1.0 (`/docs/poppy`), MCP (`/docs/mcp`), WebMCP (`/docs/webmcp`),
  UCP (`/docs/ucp`) and the Adyen calls (`/docs/adyen`). Each sequence diagram steps through its
  messages with Next and Back and has the same steps as text. A "Try it" panel reads, from the
  visitor's browser, only public documents of this origin (`/.well-known/poppy.json`,
  `/.well-known/ucp`, `/.well-known/oauth-authorization-server`, MCP `tools/list`); nothing it
  sends pays, signs in or changes state (MCP `tools/list` is a `POST`, sent without cookies, so it
  shows the `401` challenge an agent first meets). Each page links to the Back Office log filtered
  on its channels. The UCP profile's `saved_card` and `network_token` handlers point their `spec`
  at `/docs/ucp#saved-card-handler` and `#network-token-handler`. `/agents` is a short "Connect
  your AI agent" page for shoppers: the MCP address with a copy button, three steps, ChatGPT (the
  one client tested end to end), other MCP hosts, the device code and WebMCP, linking to the Docs.
- **MCP Apps UI:** `initialize` announces `resources`, `prompts` and boutique stylist instructions;
  `prompts/list` and `prompts/get` serve `personal-stylist`. `resources/list` serves
  `ui://widget/product-carousel-v2.html` and `ui://widget/cart-checkout-v2.html`
  (`text/html;profile=mcp-app`, inline script and style; `resources/read` keeps v1 aliases; unknown
  URI `-32002`), with `_meta.ui.csp` images from `PUBLIC_ORIGIN` only and `openai/widgetCSP` adding
  that origin to `redirect_domains`. A widget links only to `PUBLIC_ORIGIN` and draws an image
  only from it or from a `data:image/` URL (PNG, JPEG, WebP, GIF or SVG), the form in which the
  Ask panel hands it the store's own images. `search_catalog` and `get_product` name the carousel; cart
  and checkout tools (`complete_checkout` included) name the bag (`_meta.ui.resourceUri`, alias
  `openai/outputTemplate`, `ui.visibility` `["model","app"]`, `openai/widgetAccessible`,
  `openai/toolInvocation`). `bridge.ts` deduplicates host payloads, ignores stale
  `openai:set_globals` after `ui/initialize`, keeps updates silent via `setWidgetState` in ChatGPT
  and structured `ui/update-model-context` elsewhere, and falls back on `openExternal`. The bag
  offers "Save a test card" and "Refresh cards" when no saved card is present. `complete_checkout`
  is destructive and open-world, cancel tools destructive. `src/widgets/` builds into
  `src/server/mcp/widgets.gen.ts` with a source hash check.
- **Plugin package:** `GET /downloads/atelier-velune-plugin.zip` packages `plugin/atelier-velune/`
  (`plugin.json` meeting OpenAI listing limits, `mcp.json` with Agent Plugins `$schema`,
  `${PUBLIC_ORIGIN}/mcp` and `extensions["com.openai"].auth` CIMD, `personal-stylist` skill,
  icons), without hooks or app references; `/docs/chatgpt` explains direct MCP vs ZIP import.
- **Account:** the header shows "Sign in" or the initial menu (desktop and mobile). `/account`
  shows overview tiles, agents (state from `agent-status.ts`, UTC dates, `#agent-<grant>`), orders
  (pages of 10), saved cards and security (passkeys, sign-out). Card saves and `/checkout/[id]`
  Drop-in return through `/api/return` (`GET`/`POST`, validated `/account` or `/checkout/chk_*`
  target, session lookup by ref), pass the public `clientKey`, defer unmount off Adyen's callback
  tick, retry card refresh once in production, and fall back to `app/error.tsx` on UI error.
- **Task coverage (PAP 1.0 §9):** `GET /poppy/tasks` gives every caller the same document, a
  published artifact (`public, max-age=300`, ETag): `excluded_tasks` and `feedback.endpoint`
  (`/poppy/feedback`), no `skill_index`. The excluded tasks: creating an account, saving a card
  and changing an agent's spend limit, which only the shopper does on the website (a `web`
  reference to `/sign-up` or `/account`); paying with a plain card number, whose alternative is a
  network token or the shopper at `continue_url` (`mcp` and `openapi` references to the complete
  operation); returns and refunds, with no alternative. `POST /poppy/feedback` takes `task` (1 to
  200 characters) and `description` (1 to 2,000), answers 202 with no body and records the
  report in the trace (channel `pap`), attributed to the client of a verified Session, else to
  "unverified agent"; the text is shown, never acted on. Both check `Poppy-Version` and a
  `Poppy-Session` when one is sent, with PAP's JSON errors, and share the agents' limit per
  address. They need no access token; when one is sent, the Session's `ath` must cover it.
- **Sign-out (RFC 7009):** revoking a live refresh token at `/oauth/revoke` revokes its grant, so
  every token of that sign-in stops and the account shows the agent disconnected; revoking an
  access token, or a refresh token already replaced, stops that token only.
- **Signals:** an anonymous open checkout carries an `identity_optional` info message naming the
  agent's three choices: its own network token, signing in for the account's saved card, or no
  instrument to hand the shopper `continue_url`.
- **Refusals:** `invalid_session` 400 (an expired or invalid delegation included; the store
  remembers no ended Session, so it never answers `session_ended`): PAP's JSON body at
  `/poppy/*`, a UCP error body (`unrecoverable`) on UCP REST, and a JSON-RPC error `-32000` with
  `data {code, content}` on MCP (PAP's UCP extension §9); `version_unsupported` 400 keeps PAP's
  JSON body everywhere (PAP 1.0 §3.4); profile negotiation (UCP error body with
  `continue_url` the store's home page on REST, JSON-RPC `-32001` with `data {code, content,
  continue_url}` on MCP): `invalid_profile_url` 400 (missing, malformed, refused, or header and
  `meta` naming different profiles), `profile_unreachable` 424, `profile_malformed` 422,
  `version_unsupported` 422, and `capabilities_incompatible` as a 200 error body (an MCP result);
  `request_too_large` 400 (MCP `-32602`) for a lookup over 50 ids; `invalid_pagination` 400
  (MCP `-32602`) for a bad `pagination.limit` or `cursor`; `invalid_target` (OAuth)
  for a resource the store does not serve or the grant was not issued for; on UCP REST
  a UCP error body (`ucp` and `messages` only) with `identity_required` 401 or
  `insufficient_scope` 403, whose `WWW-Authenticate: Bearer` carries `realm` (the issuer),
  `resource_metadata`, `error` when a token was sent, and on 403 the operation's full `scope`; on
  MCP the same 401 (no token and no Session, or a bad token) and 403, with the same challenge,
  carry a JSON-RPC error `-32000` with `data {code, content}`, never a tool result (UCP: the HTTP
  status first), and 429 carries `data.retry_after` with `Retry-After`;
  `invalid_scope`/`invalid_client`/`invalid_grant`/`unauthorized_client`, and for the device
  grant `authorization_pending`, `slow_down`, `access_denied`, `expired_token` (OAuth);
  `rate_limited` 429 on `/oauth/token` and `/oauth/revoke` past the agents' limit per address;
  `invalid_request` 400 for a feedback report that is not a JSON object with both strings in
  bounds; 409 idempotency key reused with another body, 404 unknown or foreign resource. A 401 or 403 is never stored under its Idempotency-Key: the
  operation did not run, so the same key with a better token runs it. Stored answers belong to
  the agent client and the account together: one client acting for two accounts never gets one
  account's answer replayed to the other (`src/server/accounts/customers.test.ts`).
  Payment instruments: `unsupported_handler` 400 for a handler other than the two,
  `unknown_instrument` 400 for a saved card the token may not use or an instrument with no id, `invalid_credential` 400 with
  the path of the bad network-token field (`number` when Adyen gives the number no brand),
  `payment_unavailable` 502 when the brand lookup fails (nothing paid, the checkout unchanged).
  Accounts: `invalid_login` 401 (one answer for an unknown email and a wrong password),
  `email_taken` 409, `weak_password` 400, `sign_in_required` 401 on `/api/account/*` and passkey
  registration, `too_many_attempts` 429 after ten failed sign-ins (per address and per account),
  `rate_limited` 429 past 20 Drop-in and card-save sessions a minute per address (and 20 passkey
  sign-in starts), `invalid_passkey` 401. Raising an agent's limit at `/api/account/grants/:id`
  without a confirmation is `confirmation_required` 401; a wrong password there is
  `invalid_login` 401 and counts toward the sign-in limits; a passkey confirmation takes a
  single-use challenge from `/api/account/confirm/options` (`no_passkey` 409 for an account with
  none) and must be one of this account's passkeys, verified on the device (`invalid_passkey`
  401); a disconnected agent's limit is `agent_disconnected` 409. Passkey registration options
  take the same `confirm` and answer the same refusals. Consent and `/oauth/device/verify` without a session
  answer 303 to `/sign-in?next=…`, which returns only to a path on this site: `next` must start
  with `/`, hold no control character, space or backslash, and resolve to a path of this origin
  that does not itself start with `//` (dot segments collapse while parsing; `src/lib/session.test.ts`).

## Invariants

1. TEST only: endpoints are fixed to `*-test.adyen.com`; a client key must start with `test_`.
2. The server computes every price, total and currency; the order state comes only from Adyen's
   answers and HMAC-valid webhooks. Each payment record keeps the lines its amount was priced from,
   and the order is placed from those lines, not from the checkout, which stays editable while a
   Drop-in session is open. When Adyen reports an amount other than the one sent, no order is
   placed and the checkout is held with `amount_mismatch`. Payments are found by reference or
   session id, never inside a window of recent rows. A late refusal of an earlier attempt neither
   reopens the checkout nor gives budget back.
3. An agent pays with a saved card only with a valid access token carrying the checkout and pay
   scopes (a token without the checkout scope cannot complete at all: 403), a grant that is not
   revoked, a card of the grant's account, and a total at or under the grant's remaining limit;
   with its own network token, a signed-in agent needs the same token, grant and limit, a guest
   none of them; otherwise `requires_escalation`. The grant is re-read after the card lookup and the total is reserved on it
   when the checkout is claimed, with nothing awaited in between, so completes on several checkouts
   at once cannot together pass the limit. Each payment's reservation is settled once: the first of
   the synchronous refusal, a network error or a refusal webhook gives it back, and a success
   webhook for a payment whose reservation was given back charges it again before the order. The
   synchronous answer re-reads the payment and the checkout first: when a webhook already placed
   the order or held a mismatch during the call, it neither places a second order nor releases.
4. A checkout is paid at most once: it is re-read after the card lookup and `complete_in_progress`
   is claimed before the call with nothing awaited in between, so two completes at once send one
   payment; the idempotency key is `agent-pay-<checkout id>-a<attempt>`; a refusal opens a new
   attempt, a network error retries the same key; a completed checkout is immutable. A Drop-in
   result is likewise re-read after Adyen answers, so a repeated result places one order.
5. Every PAP MUST that applies to the merchant side maps to a test (matrix in the app's
   `src/server/pap/conformance.test.ts`).
6. No secret, token, client assertion or stored payment method id appears in the trace, logs or
   pages unredacted.
7. A token acts only within the scopes the shopper approved; a legacy name grants exactly the UCP
   scopes it stands for, and every operation's scope is declared once and used by both the check
   and the OpenAPI description. Consent only narrows what was asked. Reading an order needs a
   token (the hard gate) and returns only orders placed through that token's client for that
   token's account; any other id, a shopper's own order included, is 404. A cart or checkout made
   through a token is likewise visible only to the same client for the same account.
8. A device code is single use, expires after 600 s, and yields tokens only after the shopper
   approved its user code on the consent page; polling faster than the interval answers
   `slow_down` and widens it by 5 s. Wrong user codes are limited per address and in total; only a
   wrong code is remembered, and at most 1,000 addresses at once. Starting a device sign-in shares
   the agents' limit of 240 requests a minute per address; since a caller can still hold many
   addresses (an IPv6 prefix, or any header on a run without Cloudflare), the store also holds at
   most 1,000 device requests (then `temporarily_unavailable`, 503), each deleted one lifetime
   after it expires, and the limiter tracks at most 10,000 addresses.
9. WebMCP tools never pay, read orders or touch consent and grants: no tool takes a payment
   instrument, and `/account`, `/consent`, `/device` and `/back-office` register none. The five
   tools register under one signal, all or none, and leave when the page does. They hold no
   secret and see only what the page itself shows.
10. Every per-address limit (UCP, `/mcp`, starting a device sign-in, wrong user codes) counts one
    client address, `clientIp` in `src/server/protocol.ts`: `CF-Connecting-IP`, which Cloudflare
    in front of every public Render web service writes over any copy the caller sent; without it
    the last `X-Forwarded-For` entry, the one the nearest proxy appended (Next.js sets the
    socket's address when none came); with neither a valid address, one shared `local` client.
    The first entry of a longer chain is the caller's to write and never counts, so a forged one
    neither escapes a limit nor gets another address limited. `packages/platform`'s
    `clientAddress` applies the same rule for Digital and styling (`src/server/security.test.ts`
    "client address", `src/server/oauth/device.test.ts` the two forged-entry tests).
11. A platform profile is fetched only under the guards above, and only after the rate limit and
    the token check; a profile that cannot be fetched, read or negotiated stops the request before
    any operation runs, and that refusal is never stored under an Idempotency-Key
    (`src/server/ucp/profile.test.ts`).
12. A token works only at the resource it was issued for; a refresh token keeps every resource and
    scope of its grant, so narrowing one access token never narrows the next; a `resource` the
    store does not serve never yields a code or a token (`src/server/oauth/oauth.test.ts` and
    `src/server/oauth/device.test.ts`, "resource indicators").
13. A Session is accepted only with its delegation in the JWT header, signed by a key the client
    publishes, unexpired, and only with `aud` equal to the issuer; a delegation in the claims, an
    `aud` array or the MCP URL as `aud` is `invalid_session`. Its `jti` is remembered until its
    `iat` can no longer pass the 300 s check (`max(now, iat) + 300 s`), so it is accepted once
    (`src/server/pap/conformance.test.ts`).
14. A customer session is 32 random bytes in an HttpOnly, SameSite=Lax cookie (Secure and
    `__Host-` on https), stored only as its SHA-256, valid 7 days and deleted at sign-out; a
    password is stored only as an argon2id hash; a passkey's challenge is used once within 5
    minutes. A sign-in attempt counts per address and per account before the password is checked,
    and a right password takes its count back, so ten failures, a burst sent at once included,
    refuse that address or account for 15 minutes (`src/server/accounts/customers.test.ts`).
15. A grant belongs to the customer who approved it, and consent or device approval without a
    signed-in customer grants nothing; a grant without a customer authenticates nothing, so grants
    made before accounts stop working. The account page lists every grant of the account, looked up
    by account rather than among the newest grants of the store, so each stays revocable
    (`src/server/accounts/customers.test.ts`, "agents act for an account").
16. A network-token credential serves one `/cardDetails` and one `/payments` call: it is never
    stored, traced, logged or returned (digits in an error text are masked; the idempotency
    record's hash takes each `credential` only through an HMAC whose key never reaches the
    database, so another token under the same key is still a 409), and Adyen gets
    `networkToken` with the brand it read, `ContAuth` and `UnscheduledCardOnFile`, with no
    stored-payment field. A bad field, or a checkout not ready to pay, sends the number nowhere;
    a checkout handed to the shopper takes no instrument from agents
    (`src/server/payments/network-token.test.ts`).
17. A signed-in agent's payment, by saved card or network token, is reserved on its grant's limit
    before Adyen is called, as invariant 3 describes; a guest's network-token payment has no limit
    of the store's (`src/server/payments/network-token.test.ts`).
18. Drop-in shows saved cards, and the checkout page shows the buyer, only to the checkout's own
    signed-in customer; a guest pays without stored-card fields. The browser API ignores bearer
    tokens (`src/server/accounts/customers.test.ts`, "web channel").
19. The store connects to an agent-given URL only after its host resolved to public addresses
    alone (loopback too on a loopback store), and a failure there is `invalid_client` or a profile
    refusal, never a 500 (`src/server/core/outbound.test.ts`; `src/server/pap/conformance.test.ts` "§3";
    `src/server/ucp/profile.test.ts`, "fetching the profile").
20. On MCP an authorization failure is never a successful answer: HTTP 401 or 403 with the REST
    challenge, never stored under an idempotency key. A call without a token runs only with a
    verified Session, with a guest's access and no saved card or order
    (`src/server/ucp/identity.test.ts`, "MCP").
21. Revoking a live refresh token revokes its grant: no token of that sign-in authenticates again
    (`src/server/oauth/oauth.test.ts`, "sign-out").
22. A client assertion is verified only with a key the client publishes and one of the six
    asymmetric algorithms; one signed with an HMAC, or not signed, is `invalid_client`, and a
    Session whose delegation is signed with anything but ES256 or PS384 is `invalid_session`
    (`src/server/oauth/oauth.test.ts`, "client assertion algorithms").
23. A client assertion's `aud` is exactly the issuer, the issuer with one final slash, or the token
    endpoint URL, as one string (ADR-016); an array, another endpoint, another host or no `aud` is
    `invalid_client`, and the refusal names the received `aud` in printable ASCII without `"` or
    `\`, at most 200 characters, or says "no aud"; the same holds at the revocation and device
    authorization endpoints, and a successful token request's trace names the form used
    (`src/server/oauth/oauth.test.ts`, "assertion audience").
24. An agent over its remaining limit is escalated with `manage_url` named, and never reaches
    Adyen; only the grant's own signed-in shopper changes its limit, raising it only after the
    account password (a wrong one counts toward the sign-in limits) or one of its own passkeys on a
    single-use confirmation challenge of that account, at most 1000 EUR, never on a disconnected
    agent; a session alone cannot add a passkey either (`src/server/accounts/customers.test.ts`, "a session
    alone cannot add a passkey"); the trace names how a raise was confirmed; the new limit binds the next payment on the
    same grant, what was spent stays, and the answer's `agent_budget` shows the spend after its
    own charge; a limit posted as NaN is stored as 0, and `complete_checkout` on a token checked
    before the limit was lowered answers `requires_escalation` with the lowered `agent_budget`
    (`src/server/payments/network-token.test.ts`, "agent budget").
25. The Back Office pages every list on the server: page and size come only from `page` (a
    positive integer, else 1, past the last page the last) and `per` (25, 50 or 100, else 25);
    filters narrow the count and the page together; no email appears unmasked in its HTML or in
    `GET /api/back-office`, whatever shape the store accepts (any `x@y.z` without spaces, so a
    non-ASCII name or a numeric top-level domain too), an agent's own name included
    (`src/server/back-office/back-office.test.ts`).
26. The consent page names each requested permission in words with its change pill and personal
    data mark, never a scope name, keeps the one-sentence warning, sends `spend_limit_eur` 0
    when `ucp:pay` is not asked, and has Allow as its first submit button, the one Enter in the
    budget field presses (`src/components/ConsentForm.test.tsx`).
27. The Docs pages render on the server with every diagram's steps as text, and their Try it
    panels send only a `GET` of this origin's public documents or a `POST` of MCP `tools/list` to
    this origin's `/mcp` (`src/components/docs/docs.test.tsx`).
28. The UI resources (v2 URIs and v1 aliases) answer where `tools/list` does, load nothing outside
    `PUBLIC_ORIGIN`, match their sources' hash, and serve `prompts/list`/`prompts/get`
    (`src/server/mcp/widgets.test.ts`).
29. A widget has no authority: "By hand" calls UCP tools (named `saved_card`, single-attempt
    idempotency keys, extending the open bag), "With the assistant" sends a sentence, and the bridge
    pins parent origin and suppresses stale host `toolOutput` / composer text
    (`src/widgets/logic.test.ts`, `src/server/mcp/widgets.test.ts`, `src/widgets/bridge.test.ts`).
30. The plugin ZIP holds its listed files, `$schema`, `${PUBLIC_ORIGIN}/mcp`, OpenAI OAuth CIMD
    and valid listing fields, with no app reference or hook (`src/server/mcp/plugin.test.ts`).

## Determinism

Deterministic: catalogue, pricing, state machine, token checks. No model runs in this app; the agent
is whatever LLM the shopper points at it.

## Acceptance checks

- `bun run --cwd apps/adyen-agentic-commerce check` (types, `bun test` with the Adyen double from
  `bunfig.toml`'s preload, `next build`); the root `bun run check` runs the same steps, then
  `ssr:assert` boots the standalone server and expects "Agentic Commerce" on the home page.
- Locally, `bun run scripts/pap-agent.ts` checks that `poppy.json` names the site's own domain and
  that the issuer lists the MCP URL in `protected_resources`, signs in as a PAP client, waits for
  the shopper's consent (or `--auto-consent`) and buys one item over MCP.
- `src/server/pap/conformance.test.ts` "task coverage": the tasks document's shape and references,
  feedback 202 with attribution only after a verified Session, and its `invalid_request` cases.
- `poppy.json` passes the PAP 1.0 §3.1/§4.7 shape test; the UCP profile's scope keys match the
  UCP `scope_token` pattern; every OpenAPI path routes to the operation its `operationId` names.
- Answers captured from a local run (search, lookup, product, cart, checkout, order, the profile
  refusals) validate with `ucp-schema` 1.4.1 against the UCP 2026-08-25 schemas. The tool is run by
  hand, not installed in the repository.
- The device grant runs end to end in tests: code, wrong code, consent, pending, slow_down,
  tokens, an MCP call, then the code refused as used.
- `src/lib/webmcp.test.ts`: tool names and descriptions within the draft's rules and Chrome's
  budgets (name 30, description 500, parameter 150, output 1.5K characters), each tool's answer
  matching the `outputSchema` it declares, all-or-none
  registration, none on the shopper's own pages, and the cart and checkout calls against the API.
  In a browser, a stand-in `document.modelContext` sees the five tools register on `/shop` and
  leave on `/account`.
- MCP Apps: both widgets in a browser inside a stand-in host (both bridges, both modes, 375 and
  1440 px, light and dark); in ChatGPT, the owner's own account: the carousel renders, a by-hand
  "Add to bag", and a saved-card payment after the host's confirmation.
- On TEST: a human Drop-in payment Authorised; a zero-value card save; an agent `complete_checkout`
  Authorised with ContAuth; the matching `AUTHORISATION` webhook accepted.
- Accounts: sign-up, sign-in, sign-out and a passkey registered then used to sign in, in a
  browser on `localhost` (passkeys need a secure context) and on Render.
- Network token: `src/server/payments/network-token.test.ts` checks the brand lookup, the exact `/payments`
  body against the Adyen double and that no credential field reaches the database, the trace or an
  answer. On TEST (2026-11-17, local run) a guest agent's payment with `4111111111111111` and an
  expiry was Authorised, brand `visa`; another merchant account may need Adyen Support to enable
  network-token payments first (ADR-015).

## Out of scope

- LIVE payments, refunds and captures from this app.
- In a widget: entering a card, ChatGPT's embedded checkout (`requestCheckout`, private beta),
  `_meta.ui.domain` and the public plugin directory (ADR-017).
- Adyen's own UCP tokenizer until the owner's account has the role (the handler is behind config).
- Email verification, password reset and account deletion (no mail is sent; ADR-015). The former
  demo shopper `ogaccountnew` is not inherited by any account.
- Clear card numbers from agents (UCP's PAN credential) and Adyen's own UCP tokenizer or ACP
  delegated payments, which need roles Adyen grants. The `network_token` handler takes a token
  number; on TEST a test card number stands in for one.
- Sign-in, consent, account and Back Office are also behind the playground's basic auth when it
  is set (the proxy strips the quotes
  `docker run --env-file` keeps, like the config reader; `src/server/security.test.ts`, and
  `src/proxy.test.ts` through the proxy itself). Because a
  browser attaches that basic auth to a cross-site form POST, the proxy also refuses a state-changing
  request on those paths whose `Sec-Fetch-Site`, or else `Origin`, names another site; the consent
  decision cannot be forged from another page. Every response carries the platform's security
  headers (`X-Frame-Options: DENY` among them), so the consent page cannot be framed; only the
  microphone is allowed to the store's own pages, for the Ask agent's voice.
- Conversations, browser sign-in and the Operations extension of PAP; `skill_index`, and feedback
  answered with an alternative (every report gets 202).
- A host whose DNS answer changes between the address check and the fetch's own lookup (DNS
  rebinding): the check resolves the name, the fetch resolves it again.
- UCP message signatures, order webhooks to the platform, `supported_versions` (the store speaks
  2026-08-25 only), OAuth PAR and DPoP.

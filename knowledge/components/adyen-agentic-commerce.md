---
type: Component
title: "adyen-agentic-commerce: a store any AI agent can buy from, paid on Adyen TEST"
description: "Bun app (Next.js 16, Elysia, Eden): a fashion store exposed over UCP 2026-08-25 (REST and MCP) behind PAP 1.0 sign-in, with human Drop-in checkout and agent payments on a saved card, all on Adyen TEST."
tags: [component, agentic, pap, ucp, mcp, checkout, bun]
status: draft
scope: component-adyen-agentic-commerce
generated:
  by: claude-code/opus-5.5
  at: 2026-11-17T22:00:00Z
verified:
  - at: 2026-11-15
    check: "Local run on Adyen TEST: zero-value card save Authorised, human Drop-in payment Authorised, and scripts/pap-agent.ts complete_checkout Authorised with ContAuth on the saved card; no webhook reached localhost."
  - at: 2026-11-16
    check: "bun test: 184 pass (device grant, identity linking, OpenAPI vs answers, WebMCP, agent states); tsc, biome, next build (rerun after Next's advisory stop) and SSR assertion pass; browser with a stand-in modelContext: tools on /shop, none on /account; pap-agent.ts completed on Adyen TEST."
  - at: 2026-11-17
    check: "bun run check green: 199 agentic tests (a PAP agent without scope gets invalid_scope, other clients the defaults; device starts limited, capped at 1,000, expired ones deleted), types, Biome, builds, SSR assertion; /agents read at 375 px and desktop width."
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
    title: Pages (app/), API (app/api), server modules (server/)
---

# adyen-agentic-commerce

## Intent

A demo store (clothes, bags, accessories; fictional brand, original SVG product art) that a shopper
can use directly and that **any MCP-capable LLM** can shop on their behalf from the site address
alone. It shows merchants the full chain: discovery (PAP 1.0), catalogue, cart and checkout (UCP
2026-08-25 over REST and MCP), sign-in with a spend limit, and a **real Adyen TEST payment** that
appears in the Customer Area. Owner decision 2026-11-15: Bun + Elysia + Eden + Next.js replace the
Fresh app ([ADR-012](../decisions/ADR-012-agentic-app-on-bun-and-next.md)).

## Data sources

| Source                                    | What is read                                                   | Owner | Freshness           |
| ----------------------------------------- | -------------------------------------------------------------- | ----- | ------------------- |
| `src/server/catalog.ts`                   | Products, variants (colour, size), prices in EUR minor units   | Repo  | Shipped with build  |
| SQLite (`DATABASE_PATH`, `bun:sqlite`)    | Carts, checkouts, orders, OAuth clients/codes/tokens, grants,  | App   | Per request         |
|                                           | PAP sessions, idempotency records, protocol trace, webhooks    |       |                     |
| Adyen Checkout API v72 TEST               | `/sessions`, `/payments`, stored payment methods               | Adyen | Per call            |
| Adyen standard webhooks (HMAC)            | `AUTHORISATION` and other event codes                          | Adyen | Asynchronous        |
| Agent client metadata document + jwks_uri | `client_id`, `redirect_uris`, `jwks_uri`, public keys          | Agent | Fetched per sign-in |
| Platform profile named by `UCP-Agent`     | `ucp.version`, `ucp.capabilities`                              | Agent | Cached per URL      |
| `.env` (never read by tooling or agents)  | `ADYEN_API_KEY`, `ADYEN_MERCHANT_ACCOUNT`, `ADYEN_CLIENT_KEY`, | Owner | Boot                |
|                                           | `ADYEN_HMAC_KEY`, `PUBLIC_ORIGIN`, `DATABASE_PATH`, `PORT`     |       |                     |
| Deploy variable (public, optional)        | `WEBMCP_ORIGIN_TRIAL_TOKEN`, sent as `Origin-Trial` on pages   | Owner | Per request         |

From v0.3.2 the Render Blueprint sets `DATABASE_PATH=/var/data/agentic.sqlite` on a 1 GB disk;
before, every deploy or restart emptied orders, agents and grants.

## Inputs

- **Shopper (browser):** catalogue filters, variant choice, cart edits, shipping details, Drop-in
  (Sessions flow), consent decisions, spend limit, agent revocation, card save (zero-value auth).
- **Agent (HTTP):** UCP REST under `/ucp/v1` with `UCP-Agent: profile="<url>"`, `Request-Id`, and
  `Idempotency-Key` (UUID) on every mutation; MCP JSON-RPC 2.0 at `POST /mcp` with
  `meta["ucp-agent"].profile` and `meta["idempotency-key"]` (optional in MCP, honoured when sent);
  OAuth 2 (authorization code + PKCE S256; `private_key_jwt` for PAP clients, public clients
  registered by RFC 7591 for generic MCP clients); the device authorization grant (RFC 8628) for an
  agent whose browser cannot reach its own callback, for clients that declare it in `grant_types`;
  optional `Poppy-Session` (PAP 1.0 §5.2: `typ` `poppy-session+jwt`, ES256, the delegation in the
  JWT header's `poppy_dlg`, `aud` the issuer as one string, `htm`, `htu`, `ath`, `iat`, `jti`). A
  Session needs `Poppy-Version` 1.x; a missing one, or any other major version even without a
  Session, is `version_unsupported`. A `private_key_jwt` client assertion has the issuer as its one
  `aud` string, `iat` and `jti`, and lives at most 300 s; its `iat` may be at most 60 s ahead of
  the store's clock.
  `/mcp` answers 401 with the resource metadata URL until the agent signs in; REST catalogue,
  carts and checkouts also work anonymously. Client metadata documents must be https, except
  loopback ones while `PUBLIC_ORIGIN` is itself loopback (local runs and `scripts/pap-agent.ts`).
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
  Each operation belongs to one capability (`OP_CAPABILITY` in `src/server/ucp.ts`); it runs only
  when that capability was kept. The cheap checks (route, headers, body, Idempotency-Key) come
  before the fetch.
- **Resource indicators (RFC 8707):** `resource` on authorize, device authorization and token
  requests must be `PUBLIC_ORIGIN` (UCP REST) or `${PUBLIC_ORIGIN}/mcp`, compared after RFC 3986
  normalisation (the origin's trailing slash is the origin; a query, fragment or other path is
  not), and may repeat; at the token endpoint it must also be one the grant was issued for, and it
  is checked before a device code or refresh token is spent. A token issued for one resource is
  accepted only there (401 `invalid_token` elsewhere); a token issued without one is accepted at
  both; a refresh keeps the resource unless it narrows it. `scripts/pap-agent.ts` asks for the
  MCP URL, as MCP's authorization spec requires.
- **Scopes:** advertised under their UCP names, each with its PAP 1.0 §4.7 hint.

  | Scope                              | Lets the agent                                        | Changes      | Personal data |
  | ---------------------------------- | ----------------------------------------------------- | ------------ | ------------- |
  | `dev.ucp.shopping.cart:manage`     | create, update and cancel carts                       | reversible   | no            |
  | `dev.ucp.shopping.checkout:manage` | create, update, complete and cancel checkouts         | reversible   | yes (address) |
  | `ucp:pay`                          | pay with the saved card within the grant's limit      | irreversible | yes (card)    |
  | `dev.ucp.shopping.order:read`      | read the orders it placed                             | none         | yes           |
  | `profile`                          | read the shopper's name and email                     | none         | yes           |

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
- **Catalogue:** UCP's `filters.categories` (any of the listed ones) and `filters.price` (`min`,
  `max`, minor units) on search, lookup and product; the singular `category` this store read
  before stays accepted. Search pages with `pagination.limit` (10 by default, at most 50) and the
  opaque `pagination.cursor` it returned. Lookup takes at most 50 distinct ids. Product takes
  `selected` options and `preferences`, option names in priority order: when no variant matches
  them all, the last one is dropped first (UCP keeps the higher-priority selections).
- **Cart to checkout:** a create-checkout request with `cart_id` takes the cart's lines and buyer
  (UCP 2026-08-25 cart extension); its own `line_items`, and its `buyer` when the cart has one, are
  ignored, not parsed (`src/server/ucp.test.ts` "cart to checkout").
- **Amounts:** integers in EUR minor units, computed by the server from the catalogue. An agent
  never sends a price; any client-sent price or total is ignored.

## Outputs

- **Discovery:** `/.well-known/poppy.json`, `/.well-known/oauth-protected-resource` (and
  `/.well-known/oauth-protected-resource/mcp`), `/.well-known/oauth-authorization-server`,
  `/.well-known/ucp`. `poppy.json` gives `auth.scopes` as a map of scope to description and
  `auth.scope_hints` keyed by scope with both `changes` and `personal_data` (PAP 1.0 §3.1, §4.7).
  The UCP profile lists `dev.ucp.common.identity_linking` with `config.scopes` holding only
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
- **Payment:** a signed-in agent within the spend limit pays with the shopper's saved card:
  `/payments` with `storedPaymentMethodId`, `shopperInteraction: ContAuth`,
  `recurringProcessingModel: UnscheduledCardOnFile`, `shopperReference: ogaccountnew`, idempotency
  key bound to the checkout. Otherwise the checkout returns `requires_escalation` and the shopper
  pays or approves at `continue_url`.
- **Back Office:** orders, their checkout, every protocol exchange (secrets redacted), Adyen
  `pspReference`, result code, webhooks.
- **Account:** each connected agent shows where it stands (`src/lib/agent-status.ts`): consent
  given, access issued, connected (first and last authenticated request, in UTC), or
  disconnected. A consent alone never reads as connected. What it may do is listed in the consent
  page's words, never as scope names.
- **Signals:** an anonymous open checkout carries an `identity_optional` info message (signing in
  lets the agent pay with the saved card).
- **Refusals:** `invalid_session` 400 (an expired or invalid delegation included; the store
  remembers no ended Session, so it never answers `session_ended`), `version_unsupported` 400
  (PAP); profile negotiation (UCP error body with
  `continue_url` the store's home page on REST, JSON-RPC `-32001` with `data {code, content,
  continue_url}` on MCP): `invalid_profile_url` 400 (missing, malformed, refused, or header and
  `meta` naming different profiles), `profile_unreachable` 424, `profile_malformed` 422,
  `version_unsupported` 422, and `capabilities_incompatible` as a 200 error body (an MCP result);
  `request_too_large` 400 (MCP `-32602`) for a lookup over 50 ids; `invalid_pagination` 400
  (MCP `-32602`) for a bad `pagination.limit` or `cursor`; `invalid_target` (OAuth)
  for a resource the store does not serve or the grant was not issued for; on UCP REST
  a UCP error body (`ucp` and `messages` only) with `identity_required` 401 or
  `insufficient_scope` 403, whose `WWW-Authenticate: Bearer` carries `realm` (the issuer),
  `resource_metadata`, `error` when a token was sent, and on 403 the operation's full `scope`; MCP
  answers 401 `invalid_token` before sign-in; `invalid_scope`/`invalid_client`/`invalid_grant`/
  `unauthorized_client`, and for the device grant `authorization_pending`, `slow_down`,
  `access_denied`, `expired_token` (OAuth); 409 idempotency key reused with another body, 404
  unknown or foreign resource. A 401 or 403 is never stored under its Idempotency-Key: the
  operation did not run, so the same key with a better token runs it.

## Invariants

1. TEST only: endpoints are fixed to `*-test.adyen.com`; a client key must start with `test_`.
2. The server computes every price, total and currency; the order state comes only from Adyen's
   answers and HMAC-valid webhooks. Each payment record keeps the lines its amount was priced from,
   and the order is placed from those lines, not from the checkout, which stays editable while a
   Drop-in session is open. When Adyen reports an amount other than the one sent, no order is
   placed and the checkout is held with `amount_mismatch`. Payments are found by reference or
   session id, never inside a window of recent rows. A late refusal of an earlier attempt neither
   reopens the checkout nor gives budget back.
3. An agent payment happens only with a valid access token carrying the checkout and pay scopes
   (a token without the checkout scope cannot complete at all: 403), a grant that is not revoked, a
   saved card, and a total at or under the grant's remaining limit; otherwise
   `requires_escalation`. The grant is re-read after the card lookup and the total is reserved on it
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
   `src/server/conformance.test.ts`).
6. No secret, token, client assertion or stored payment method id appears in the trace, logs or
   pages unredacted.
7. A token acts only within the scopes the shopper approved; a legacy name grants exactly the UCP
   scopes it stands for, and every operation's scope is declared once and used by both the check
   and the OpenAPI description. Consent only narrows what was asked. Reading an order needs a
   token (the hard gate) and returns only orders placed through that token's client; any other
   id, a shopper's own order included, is 404.
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
    "client address", `src/server/device.test.ts` the two forged-entry tests).
11. A platform profile is fetched only under the guards above, and only after the rate limit and
    the token check; a profile that cannot be fetched, read or negotiated stops the request before
    any operation runs, and that refusal is never stored under an Idempotency-Key
    (`src/server/profile.test.ts`).
12. A token works only at the resource it was issued for, a refresh keeps that resource, and a
    `resource` the store does not serve never yields a code or a token (`src/server/oauth.test.ts`
    and `src/server/device.test.ts`, "resource indicators").
13. A Session is accepted only with its delegation in the JWT header, signed by a key the client
    publishes, unexpired, and only with `aud` equal to the issuer; a delegation in the claims, an
    `aud` array or the MCP URL as `aud` is `invalid_session` (`src/server/conformance.test.ts`).

## Determinism

Deterministic: catalogue, pricing, state machine, token checks. No model runs in this app; the agent
is whatever LLM the shopper points at it.

## Acceptance checks

- `bun run --cwd apps/adyen-agentic-commerce check` (types, `bun test` with the Adyen double from
  `bunfig.toml`'s preload, `next build`); the root `bun run check` runs the same steps, then
  `ssr:assert` boots the standalone server and expects "Agentic Commerce" on the home page.
- Locally, `bun run scripts/pap-agent.ts` signs in as a PAP client, waits for the shopper's consent
  (or `--auto-consent`) and buys one item over MCP.
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
- On TEST: a human Drop-in payment Authorised; a zero-value card save; an agent `complete_checkout`
  Authorised with ContAuth; the matching `AUTHORISATION` webhook accepted.

## Out of scope

- LIVE payments, refunds and captures from this app.
- Adyen's own UCP tokenizer until the owner's account has the role (the handler is behind config).
- Real user accounts: one demo shopper (`ogaccountnew`). Consent, account and Back Office are
  protected only by the playground's basic auth when it is set (the proxy strips the quotes
  `docker run --env-file` keeps, like the config reader; `src/server/security.test.ts`, and
  `src/proxy.test.ts` through the proxy itself). Because a
  browser attaches that basic auth to a cross-site form POST, the proxy also refuses a state-changing
  request on those paths whose `Sec-Fetch-Site`, or else `Origin`, names another site; the consent
  decision cannot be forged from another page. Every response carries the platform's security
  headers (`X-Frame-Options: DENY` among them), so the consent page cannot be framed.
- Conversations, browser sign-in and the Operations extension of PAP.
- UCP message signatures, order webhooks to the platform, `supported_versions` (the store speaks
  2026-08-25 only), OAuth PAR and DPoP.

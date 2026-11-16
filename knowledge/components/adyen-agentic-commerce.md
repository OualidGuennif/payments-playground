---
type: Component
title: "adyen-agentic-commerce: a store any AI agent can buy from, paid on Adyen TEST"
description: "Bun app (Next.js 16, Elysia, Eden): a fashion store exposed over UCP 2026-08-25 (REST and MCP) behind PAP 1.0 sign-in, with human Drop-in checkout and agent payments on a saved card, all on Adyen TEST."
tags: [component, agentic, pap, ucp, mcp, checkout, bun]
status: draft
scope: component-adyen-agentic-commerce
generated:
  by: claude-code/opus-5.5
  at: 2026-11-16T22:30:00Z
verified:
  - at: 2026-11-15
    check: "bun test: 123 cases pass (PAP conformance, OAuth, UCP and payment state machine, commerce, security, the budget race, reservations settled once, paid lines, amount mismatch, cross-site writes) against the Adyen double; tsc clean; next build."
  - at: 2026-11-15
    check: "Local run on Adyen TEST: zero-value card save Authorised, human Drop-in payment Authorised, and scripts/pap-agent.ts complete_checkout Authorised with ContAuth on the saved card; no webhook reached localhost."
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
| `.env` (never read by tooling or agents)  | `ADYEN_API_KEY`, `ADYEN_MERCHANT_ACCOUNT`, `ADYEN_CLIENT_KEY`, | Owner | Boot                |
|                                           | `ADYEN_HMAC_KEY`, `PUBLIC_ORIGIN`, `DATABASE_PATH`, `PORT`     |       |                     |

## Inputs

- **Shopper (browser):** catalogue filters, variant choice, cart edits, shipping details, Drop-in
  (Sessions flow), consent decisions, spend limit, agent revocation, card save (zero-value auth).
- **Agent (HTTP):** UCP REST under `/ucp/v1` with `UCP-Agent: profile="<url>"`, `Request-Id`, and
  `Idempotency-Key` (UUID) on every mutation; MCP JSON-RPC 2.0 at `POST /mcp` with
  `meta["ucp-agent"].profile` and `meta["idempotency-key"]` (optional in MCP, honoured when sent);
  OAuth 2 (authorization code + PKCE S256; `private_key_jwt` for PAP clients, public clients
  registered by RFC 7591 for generic MCP clients); the device authorization grant (RFC 8628) for an
  agent whose browser cannot reach its own callback, for clients that declare it in `grant_types`;
  optional `Poppy-Session` + `Poppy-Version: 1.0`.
  `/mcp` answers 401 with the resource metadata URL until the agent signs in; REST catalogue,
  carts and checkouts also work anonymously. Client metadata documents must be https, except
  loopback ones while `PUBLIC_ORIGIN` is itself loopback (local runs and `scripts/pap-agent.ts`).
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
  issued with.
- **Device sign-in:** `POST /oauth/device_authorization` returns a device code, an 8-letter user
  code (`BCDF-GHJK` alphabet, RFC 8628 §6.1), `/device` as the verification URI, 600 s and a 5 s
  interval. The shopper types the code at `/device`, then sees the same consent page.
- **Catalogue search:** UCP's `filters.categories` (any of the listed ones) and `filters.price`
  (`min`, `max`, minor units); the singular `category` this store read before stays accepted.
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
- **Account:** each connected agent shows where it stands: consent given, token issued, first and
  last authenticated request, or disconnected. A consent alone never reads as connected.
- **Signals:** an anonymous open checkout carries an `identity_optional` info message (signing in
  lets the agent pay with the saved card).
- **Refusals:** `invalid_session` 400, `session_ended` 400, `version_unsupported` 400; on UCP REST
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
   `slow_down` and widens it by 5 s. Wrong user codes are limited per address and in total.

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
- The device grant runs end to end in tests: code, wrong code, consent, pending, slow_down,
  tokens, an MCP call, then the code refused as used.
- On TEST: a human Drop-in payment Authorised; a zero-value card save; an agent `complete_checkout`
  Authorised with ContAuth; the matching `AUTHORISATION` webhook accepted.

## Out of scope

- LIVE payments, refunds and captures from this app.
- Adyen's own UCP tokenizer until the owner's account has the role (the handler is behind config).
- Real user accounts: one demo shopper (`ogaccountnew`). Consent, account and Back Office are
  protected only by the playground's basic auth when it is set (the proxy strips the quotes
  `docker run --env-file` keeps, like the config reader; `src/server/security.test.ts`). Because a
  browser attaches that basic auth to a cross-site form POST, the proxy also refuses a state-changing
  request on those paths whose `Sec-Fetch-Site`, or else `Origin`, names another site; the consent
  decision cannot be forged from another page. Every response carries the platform's security
  headers (`X-Frame-Options: DENY` among them), so the consent page cannot be framed.
- Conversations, browser sign-in and the Operations extension of PAP.

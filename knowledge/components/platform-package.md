---
type: Component
title: "packages/platform: the server-side library every app shares"
description: "Module by module, what packages/platform owns: the Adyen TEST client, configuration, profiles, SQLite storage, security and CSRF, HMAC, sanitising, the order state machine, lifecycle rules and per-market data."
status: stable
scope: component-platform
tags: [component, platform, server]
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - resource: ../../packages/platform
    title: "The package, its tests next to each module, and its migrations"
  - resource: ../../packages/platform/adyen.ts
    title: "AdyenTestClient, AdyenRequestError and the two Deno < 2.8 transport workarounds"
  - resource: ../../packages/platform/base-api.ts
    title: "createPlatformContext, selectedSecrets and the shared routes"
  - resource: ../../packages/platform/storage.ts
    title: "Repository, the retention cap and the timeline"
  - resource: ../../packages/platform/state-machine.ts
    title: "mapAdyenResultCode and resolveOrder"
  - resource: ../../packages/platform/security.ts
    title: "Session and CSRF cookies, origin checks, rate limit, headers, Basic Auth"
  - resource: ../../packages/platform/profiles.ts
    title: "The env-backed default profile and AES-256-GCM stored profiles"
  - resource: ../../packages/platform/lifecycle.ts
    title: "Per-method capabilities and actionPermissions"
  - resource: ../../packages/platform/modifications.ts
    title: "reconcile, ledgerOf and the webhook outcomes"
  - resource: ../../packages/platform/config.ts
    title: "Environment and .env loading, derived paths and the default profile"
  - resource: ../../packages/platform/hmac.ts
    title: "Standard-notification and header HMAC verification"
  - resource: ../architecture/payment-lifecycle.md
    title: "The order/attempt model the state machine implements"
  - resource: ../architecture/data-model.md
    title: "The tables storage.ts reads and writes"
  - resource: ../../apps/adyen-digital/api.ts
    title: "How the focus app builds its API on the package"
  - resource: ../../apps/adyen-digital/main.ts
    title: "Basic Auth and security headers applied before Fresh"
---

# packages/platform

## Intent

One server-side library for the four playgrounds: every Adyen TEST call, the SQLite record of what
was asked and answered, the HTTP security middleware, webhook HMAC verification, and the pure
functions that derive an order's state, its ledger and what may be done next. A module belongs here
when a second app could plausibly want it.

Two boundaries are absolute.

- **Server only.** Nothing here may be imported from an island, with one deliberate exception:
  `markets.ts` is pure data and is imported by the digital island, so it must never import anything
  server-side.
- **TEST only.** `adyen.ts` asserts the TEST environment on every call, and `test-only.ts` refuses a
  LIVE-looking endpoint, client key or profile secret. There is no switch, flag or configuration
  that reaches LIVE ([ADR-001](../decisions/ADR-001-test-only-enforced-in-code.md)).

## Data sources

| Source                                                          | What is read                                                                                                                          | Owner       | Freshness                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| Environment, then `.env` files                                  | Adyen TEST credentials, `PORT`, `PUBLIC_ORIGIN`, `DATABASE_PATH`, `SESSION_SIGNING_SECRET`, `PROFILE_ENCRYPTION_KEY`, Basic Auth pair | operator    | `loadServerConfig()` once per process; a change needs a restart         |
| SQLite file at `DATABASE_PATH`                                  | The ten tables of [the data model](../architecture/data-model.md)                                                                     | this server | WAL; read and written per request, synchronously                        |
| Adyen TEST Checkout API v72                                     | Response JSON, opaque to this package                                                                                                 | Adyen       | per request; 45 s default timeout                                       |
| Adyen TEST Device API v1                                        | Response JSON for terminal calls                                                                                                      | Adyen       | per request; 120 s timeout for a sync                                   |
| Webhook deliveries                                              | Standard notification items and raw bodies                                                                                            | Adyen       | per delivery; verified against every profile's `hmacKey`                |
| `PAYMENT_METHOD_CAPABILITIES`                                   | What Adyen supports per method, plus this account's capture setting                                                                   | this repo   | checked against Adyen's docs 2026-10-10, reviewed at most 92 days apart |
| `markets.ts`, `addresses.ts`, `shopper.ts`, `sessionContext.ts` | Country currency, locale and default amount; TEST shopper fixtures                                                                    | this repo   | static                                                                  |

`config.ts` reads `Deno.env` first and only then the `.env` files, strips the quotes Docker leaves
on `--env-file` values, and derives `PUBLIC_ORIGIN`, the database path and the default profile from
what it found. Profiles added at runtime are encrypted with AES-256-GCM under
`PROFILE_ENCRYPTION_KEY`, or, locally, a key file generated next to the database.

## Inputs

`createPlatformContext(appId: AppId)` takes one of `"digital" | "ipp" | "agentic" | "styling"` and
returns the config, the `Repository`, the `ProfileStore` and a Hono `api` that already carries the
shared middleware and routes. Apps import `context.api` and add their own endpoints.

### Entry points, module by module

| Module                                            | Inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adyen.ts`                                        | `new AdyenTestClient(ProfileSecrets, httpClient?)`, then one method per endpoint: `sessions`, `paymentMethods`, `payments`, `paymentDetails`, `createPaymentLink`, `getPaymentLink`, `paymentMethodsBalance`, `createOrder`, `cancelOrder`, `capture`, `cancel`, `refund`, `terminalSync`, `connectedDevices`. Payloads are `Record<string, unknown>` built per endpoint; calls that create or modify take an `idempotencyKey: string`. Query params are supported and unused since `GET /sessions` was dropped. |
| `base-api.ts`                                     | `createPlatformContext(appId)`; `selectedSecrets(context, request)` reads the non-secret `X-Profile-Id` header, falling back to `default`, and returns `{ id, secrets }`.                                                                                                                                                                                                                                                                                                                                        |
| `config.ts`                                       | `loadServerConfig(appId)`; `unquoteEnvValue(value)`. Required fields per app: digital and styling `apiKey`, `merchantAccount`, `clientKey`; ipp `apiKey`, `merchantAccount`, `terminalId`; agentic `apiKey`, `merchantAccount`. A client key must start with `test_`.                                                                                                                                                                                                                                            |
| `profiles.ts`                                     | `ProfileStore.save(label, secrets, id?)`; `getSecrets(id)`, `getPublic(id)`, `listPublic()`, `delete(id)`. A label is trimmed to 2–80 characters.                                                                                                                                                                                                                                                                                                                                                                |
| `storage.ts`, `migrations.ts`, `migrations/`      | `Repository(path)` (`":memory:"` allowed) and its methods: order, session, attempt, payment part, API call, callback, webhook, action, audit and timeline writers, plus the matching readers.                                                                                                                                                                                                                                                                                                                    |
| `security.ts`                                     | Request cookies `adyen_session`, `adyen_csrf`, `adyen_profile_<appId>`; headers `X-CSRF-Token`, `Origin`, `X-Forwarded-For`, `Authorization`. `rateLimit(maxRequests = 120, windowMs = 60_000)`; `basicAuthChallenge(request)` reads `PLAYGROUND_BASIC_AUTH_USER` and `PLAYGROUND_BASIC_AUTH_PASSWORD`.                                                                                                                                                                                                          |
| `hmac.ts`                                         | `standardWebhookSigningString(item)`, `calculateStandardHmac(item, keyHex)`, `verifyStandardHmac(item, keyHex?)`, `verifyHeaderHmac(rawBody, signature, keyHex?)`. Keys are hex; signatures are Base64.                                                                                                                                                                                                                                                                                                          |
| `sanitize.ts`                                     | `sanitize(value)`, `mask(value)`, `rejectRawCardData(value)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `state-machine.ts`                                | `mapAdyenResultCode(resultCode)` and `resolveOrder(input, now = new Date())`, both below.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `lifecycle.ts`, `payment-methods.ts`              | `PAYMENT_METHOD_CAPABILITIES`, `capabilitiesFor(method)`, `lifecycleSourceAttempt(attempts)`, `emptyLedger(authorised)`, `actionPermissions(state, paymentMethod, ledger)`; `PAYMENT_METHOD_RULES` holds the editable defaults.                                                                                                                                                                                                                                                                                  |
| `markets.ts`                                      | A country code; returns its currency, locale, a presentable default amount and the zero-decimal currency set. Shared with the styling app.                                                                                                                                                                                                                                                                                                                                                                       |
| `addresses.ts`, `shopper.ts`, `sessionContext.ts` | TEST shopper data per market: address pairs, `weeklyShopperReference(now?)`, the dummy email, line items, risk fields, card-funding splits.                                                                                                                                                                                                                                                                                                                                                                      |
| `test-only.ts`                                    | `assertTestOnly(input)`, `profileIsTestOnly(secrets)`, `isTestClientKey(value)`.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `types.ts`                                        | The shared types: `AppId`, `Amount`, `OrderState`, `AttemptState`, `OrderAggregate`, `AttemptAggregate`, `TimelineEntry`, `PublicProfile`, `ProfileSecrets`, `LifecycleCapabilities`, `ActionPermissions`, `Modification*`, `Ledger`.                                                                                                                                                                                                                                                                            |

### `resolveOrder` input

```text
currentState         OrderState: open | payment_pending | partially_paid | paid | cancelled | expired | failed
totalValue           integer, minor units
expiresAt?           ISO 8601 timestamp
linkStatus?          active | expired | completed | paymentPending
orderClosedWebhook?  { success: boolean }
modificationWebhook? { kind: "capture" | "cancel"; success: boolean }
attempts[]           { id, state: AttemptState, value: minor units, pspReference? }
```

`reconcile(requests: ModificationRequest[], events: ModificationEvent[])` takes this playground's
`lifecycle_actions` rows and the HMAC-valid modification webhooks of one order.
`ledgerOf(authorised, modifications)` takes the minor-unit authorised total and that reconciled
list. `actionPermissions` takes the order state, the Adyen payment method name and the ledger.

`shopperReference` is `playground-shopper-<Monday's date>`, rotating weekly (UTC), and is shared by
every Sessions and Advanced call; stored cards therefore stay visible for a week.

## Outputs

- **Adyen client.** The parsed response as `unknown`, or an `AdyenRequestError` carrying
  `statusCode` and optional `errorCode`. An HTTP rejection keeps Adyen's status and message; a
  rejection with no status anywhere becomes 400; a socket failure becomes 502 with
  `Adyen TEST connection failed: …`, so "Adyen refused this" stays distinguishable from "Adyen was
  not reachable".
- **`mapAdyenResultCode`.** `Authorised` → `authorised`; `Received`, `Pending`, `PresentToShopper`,
  `RedirectShopper`, `IdentifyShopper` and `ChallengeShopper` → `pending`; `Refused` → `refused`;
  `Cancelled` → `cancelled`; `Error` → `error`; anything unknown → `created`.
- **`resolveOrder`.** `{ state, paidValue, terminal, reason }`, derived in this order: a settled
  `paid`/`cancelled` stays as it is; a successful CAPTURE gives `paid`, a successful CANCELLATION
  `cancelled`; `ORDER_CLOSED` gives `paid`/`cancelled` by `success`; a completed link with the full
  amount authorised gives `paid`; a passed link or order expiry gives `expired`; some but not all of
  the amount gives `partially_paid`; full amount or any pending attempt gives `payment_pending`;
  otherwise `open`. A refusal never closes an order. Authorised amounts are summed once per PSP
  reference.
- **`actionPermissions`.** `{ capture, cancel, refund }`, each
  `{ allowed, reason, waiting?, maxValue?, partial? }` with `maxValue` in minor units. A request
  Adyen answered `received` reports `waiting` and blocks another of its kind until its webhook
  arrives; a method captured on authorisation reports nothing to capture or cancel and is refunded
  instead.
- **`reconcile` / `ledgerOf`.** The modifications with `status` `pending`, `succeeded`, `failed`,
  `reversed` or `rejected`, and the ledger as minor units: `authorised`, `captured`,
  `capturePending`, `refunded`, `refundPending`, `cancelled`, `cancelPending`.
- **Repository.** Aggregates (`OrderAggregate`, `AttemptAggregate`, `TimelineEntry`), row ids, and
  `{ id, duplicate }` for webhook and action inserts. `timeline(correlationId)` merges API calls,
  frontend callbacks, webhooks and actions oldest first.
- **Profiles.** `PublicProfile` never carries secrets; `getSecrets` returns a copy of the default
  profile's secrets or the decrypted stored ones. A profile whose ciphertext cannot be decrypted is
  listed with `missingFields: ["decryptionFailed"]`.
- **Shared routes.** `/api/health` and `/healthz`; `/api/bootstrap` (session, profile choice,
  publishable `test_` client key, origin, webhook URL, whether an HMAC key exists, agentic mode);
  `/api/profiles` (list, create 201, preferred 404 on unknown, delete 404 on missing);
  `/api/callbacks` (400 without `correlationId` and `name`, else 201);
  `/api/timeline/:correlationId`.

### Refusals

| Refusal                                                      | Answer                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Mutating `/api/*` without matching CSRF cookie and header    | 403 `CSRF validation failed.`                                    |
| Mutating `/api/*` with a foreign `Origin`                    | 403 `Cross-origin request rejected.`                             |
| More than 120 requests a minute for one client and path      | 429 `Rate limit exceeded.` with `Retry-After`                    |
| Missing or wrong Basic Auth credentials, any path but health | 401 with `WWW-Authenticate: Basic realm="Adyen TEST Playground"` |
| A LIVE-looking endpoint, client key or secret                | `Error`, before any request leaves the process                   |
| `PROFILE_ENCRYPTION_KEY` absent on a hosted deployment       | `Error` when a custom profile is saved                           |
| Deleting the environment-backed default profile              | `Error`                                                          |
| A label shorter than two characters                          | `Error`                                                          |
| An unhandled route error                                     | 500 `{ error, correlationId }`, written to `audit_log`           |

## Invariants

1. Every Adyen call goes to the TEST host with `environment: TEST` and the profile's API key —
   `packages/platform/adyen.test.ts` "sessions uses the exact Checkout v72 TEST endpoint and TEST
   credentials".
2. An HTTP rejection keeps Adyen's status and message; a socket failure is a 502, not a 500 —
   `packages/platform/adyen.test.ts` "Adyen HTTP errors preserve the upstream status and safe
   message" and "a transport failure is reported as a connection error, not a 500".
3. A refusal never closes a still-valid order, partial tender stays open, and a settled order is
   never reopened — `packages/platform/state-machine.test.ts` "a refused attempt never closes a
   still-valid order", "partial tender remains open for the balance", "a later webhook never reopens
   a settled order".
4. One authorised PSP reference is counted once — `packages/platform/state-machine.test.ts`
   "duplicate authorised PSP references are counted once".
5. `ORDER_CLOSED`, a CAPTURE, a CANCELLATION and link expiry settle an order exactly as stated above
   — `packages/platform/state-machine.test.ts` "ORDER_CLOSED is authoritative for partial payment
   orders", "a successful CAPTURE webhook settles the order as paid", "a failed CAPTURE webhook
   leaves the authorisation where it was", "a successful CANCELLATION webhook cancels the order",
   "effective link expiration closes the order".
6. A received modification stays pending until its webhook; a later failure overturns a success; an
   event this server never asked for still counts — `packages/platform/modifications.test.ts` "a
   received capture is pending until its webhook, then settled by it", "a refused capture and a
   later CAPTURE_FAILED leave nothing captured", "a capture made in the Customer Area still counts,
   from its webhook", "an old request without its PSP reference takes the next event of its kind".
7. A pending request blocks another of its kind, and capture, cancel and refund follow the ledger
   and the method's capabilities — `packages/platform/lifecycle.test.ts` "a received capture blocks
   the next one until its webhook arrives", "Alma and Oney take one partial capture at most", "ANCV
   is refunded once and in full", "methods without separate capture are refunded, never captured or
   cancelled", "PayPal supports separate capture but this account captures it on authorisation".
8. Actions target the latest authorised attempt, never a later refusal —
   `packages/platform/lifecycle.test.ts` "lifecycle actions target the latest authorised attempt,
   not a later refusal".
9. The capability table is re-checked against Adyen's docs at most 92 days after
   `CAPABILITIES_REVIEWED_ON` — `packages/platform/lifecycle.test.ts` "the capability table was
   checked against Adyen's docs within three months".
10. HMAC verification follows the standard notification string, escapes colons and backslashes,
    matches the RFC 4231 vector and rejects any mutation — `packages/platform/hmac.test.ts` the
    three tests in that file.
11. CSRF is a double submit with a same-host Origin check, and a rejected mutation issues no
    cookies, so it cannot replace the token a concurrent bootstrap just set —
    `packages/platform/security.test.ts` "CSRF still rejects a cross-origin POST that carries a
    valid token" and "a rejected POST issues no cookies, so it cannot replace bootstrap's CSRF
    token".
12. Basic Auth, when configured, challenges every path except `/healthz` and `/api/health` —
    `packages/platform/security.test.ts` "Basic Auth, when configured, challenges every path but the
    health checks".
13. `requestOrigin` follows only a same-host Origin, and `shopperIp` prefers the first
    `X-Forwarded-For` entry over the connection — `packages/platform/security.test.ts` the two
    `requestOrigin` and three `shopperIp` tests.
14. A redelivered webhook and a double-clicked action are harmless by constraint, one PSP reference
    records one payment part, the 70 most recent orders per app are kept, and the timeline carries
    each API call's method and endpoint — `packages/platform/storage.test.ts` "webhooks and
    lifecycle actions are deduplicated idempotently", "one PSP reference records one payment part,
    however often it is reported", "orders beyond the retained cap are purged per app on creation",
    "the timeline gives each API call its method and endpoint".
15. Infrastructure credentials are redacted before persistence and raw PAN/CVC fields are refused
    while Adyen-encrypted fields are accepted — `packages/platform/sanitize.test.ts` both tests.
16. A value quoted by `docker run --env-file` is read without its quotes —
    `packages/platform/config.test.ts` "an env value quoted by `docker run --env-file` is read
    without its quotes".
17. `shopperReference` is constant within a UTC week, rotates at the Sunday-night/Monday boundary
    and keeps its readable shape — `packages/platform/shopper.test.ts` the three tests.
18. Every app answers `/api/health` with `{ status: "ok", environment: "TEST" }` without external
    credentials — `packages/platform/apps.integration.test.ts`.

## Determinism

**Deterministic** for the functions that decide anything: `mapAdyenResultCode`, `resolveOrder`,
`reconcile`, `ledgerOf`, `actionPermissions`, `capabilitiesFor`, the HMAC helpers, `sanitize` and
the market/shopper fixtures return the same output for the same input. The only clock is
`resolveOrder`'s `now` argument, so expiry is reproducible; UUIDs, nonces and timestamps are written
to the database but never feed back into a derived state.

**Bounded** where input comes from outside: an Adyen response or a webhook payload is opaque JSON,
read only through the fields the state machine, the ledger and the profile store need. An unreadable
body becomes a refusal (`AdyenRequestError`, or `{ parseError: true }` in a stored timeline
payload), never trusted free text.

**Adaptive** is not used: no model, no heuristic and no free-text authority exists in this package.

## Acceptance checks

```bash
deno task test          # every package and app test, including apps.integration.test.ts
deno test -A --parallel packages/platform
deno task types         # deno check over packages, apps and tools
deno task knowledge:check
deno task check         # the full gate: fmt, lint, knowledge, types, tests, builds, SSR
```

## Out of scope

- Reaching Adyen LIVE in any way; there is no flag for it.
- Rendering anything: no HTML, no Preact, no island import apart from the pure-data `markets.ts`.
- Holding, forwarding or logging PAN, CVC or any raw card field.
- Deciding an outcome: an order's state comes from Adyen's answers and HMAC-valid webhooks only.
- Fetching a session's status from Adyen after the fact.
- A Content-Security-Policy; it was removed deliberately
  ([ADR-005](../decisions/ADR-005-no-content-security-policy.md)).
- Retaining data beyond the 70 most recently updated orders per app.
- Being a product, a reference integration or a PCI control.

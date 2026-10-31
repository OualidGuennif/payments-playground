---
type: Component
title: "adyen-agentic-commerce: agent-initiated purchase, with the boundary labelled"
description: "The Agentic Commerce playground: a deterministic local mock, an honest 501 for real agentic mode, and a separate human-confirmed Adyen TEST Checkout session."
tags: [component, agentic, mock, checkout]
status: stable
scope: component-adyen-agentic-commerce
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - id: app
    resource: ../../apps/adyen-agentic-commerce
    title: "The app's pages, API, islands and components"
  - id: api
    resource: ../../apps/adyen-agentic-commerce/api.ts
    title: Offers, runs, the checkout handoff and the webhook
  - id: providers
    resource: ../../apps/adyen-agentic-commerce/providers.ts
    title: Offers, the local mock run and the real-mode refusal reason
  - id: main
    resource: ../../apps/adyen-agentic-commerce/main.ts
    title: Fresh, Hono and security middleware wiring
  - id: playground
    resource: ../../apps/adyen-agentic-commerce/islands/AgenticPlayground.tsx
    title: Intent form, trace and human-confirmed Drop-in
  - id: back-office
    resource: ../../apps/adyen-agentic-commerce/islands/AgenticBackOffice.tsx
    title: Run list and timeline
  - id: profiles
    resource: ../../apps/adyen-agentic-commerce/islands/AgenticProfileManager.tsx
    title: Encrypted profiles and the future bearer field
  - id: routes
    resource: ../../apps/adyen-agentic-commerce/routes
    title: Home, history, Back Office, settings, wiki and disclaimer
  - id: layout
    resource: ../../apps/adyen-agentic-commerce/components/Layout.tsx
    title: The shared AppShell wrapper
  - id: client
    resource: ../../apps/adyen-agentic-commerce/client.ts
    title: Browser stylesheet imports
  - id: vite
    resource: ../../apps/adyen-agentic-commerce/vite.config.ts
    title: Fresh and SQLite hotfix plugins
  - id: readme
    resource: ../../apps/adyen-agentic-commerce/README.md
    title: The two modes, environment variables and deployment
---

# adyen-agentic-commerce

## Intent

A teaching playground for agent-initiated purchases. Every step says what it actually is: executed
locally, simulated, or unavailable. The mock contacts no provider; real mode answers `501` because
no publicly verifiable Adyen Agentic Commerce TEST contract exists; the one path that does work end
to end is a **human-confirmed standard Adyen Checkout TEST session**, and the UI labels it that way.
Status: in progress (estimated Q1 2027); `deno task dev:agentic` runs it on port 8003, and it is not
presented as a provider integration.

Nothing here is a response from OpenAI, Copilot, Google or Adyen. The mock is a deterministic local
fixture, not a convincing fake.

## Data sources

| Source                                               | What is read                                                                                                    | Owner      | Freshness                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `providers.ts` `OFFERS`                              | Three fixed merchant offers (id, name, description, EUR minor-unit price, availability, tags)                   | Repository | Shipped with the build             |
| `providers.ts` `runLocalAgenticMock`                 | The deterministic five-step run and its selected offer                                                          | Repository | Per mock request                   |
| `providers.ts` `realAgenticUnavailableReason`        | The fixed reason returned by real mode and by `/capabilities`                                                   | Repository | Shipped with the build             |
| `packages/platform/base-api.ts` `GET /api/bootstrap` | Selected public profile, client key (only a `test_` key is exposed), all profiles, agentic flags                | Platform   | Page load and profile switch       |
| `GET /api/agentic/runs` and the SQLite repository    | Orders, API-call rows, audit rows and the timeline                                                              | App        | On page load; the UI does not poll |
| Adyen Checkout TEST `/sessions`                      | The human-confirmed session token                                                                               | Adyen      | Per confirmation                   |
| `POST /webhook`                                      | Standard notification items, HMAC-checked against every profile's key                                           | Adyen      | Asynchronous                       |
| `.env` via `packages/platform/config.ts`             | `ADYEN_API_KEY`, `ADYEN_MERCHANT_ACCOUNT`, `ADYEN_CLIENT_KEY`, `ADYEN_HMAC_KEY`, optional real-mode flags/token | Server     | Boot                               |

`AGENTIC_REAL_ENABLED` and `ADYEN_AGENTIC_BEARER_TOKEN` only shape the bootstrap flags and profile
capabilities. They do **not** unlock the real run route, which refuses before any provider call.

## Inputs

### HTTP

| Route                                               | Input                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/agentic/runs`                            | `{ "intent"?: unknown, "mode"?: unknown }`. `intent` is stringified, trimmed and cut to 1000 characters; fewer than 8 characters is `400`. Only the exact mode `real` selects real mode; anything else is `mock`. |
| `POST /api/agentic/runs/:id/checkout-session`       | Path id only. The route ignores its body; the UI's confirmation click is the human confirmation. The order must exist, belong to this app and have flow `agentic-local-mock`.                                     |
| `GET /api/agentic/offers`, `/capabilities`, `/runs` | No body.                                                                                                                                                                                                          |
| `POST /webhook`                                     | Standard `{ "notificationItems": [{ "NotificationRequestItem": { ... } }] }`, with optional HMAC.                                                                                                                 |

A mutation on `/api/*` needs the CSRF double-submit header; `X-Profile-Id` selects a non-default
profile. The checkout route needs the selected profile to have a merchant account and a client key,
or it answers `409`. The session request uses the order's amount, fixed `FR`/`en-US`, the shared
weekly shopper reference, line items, addresses and risk fields; its `returnUrl` is
`<publicOrigin>/?agenticRun=<order id>`.

### UI

The home page has a profile picker, a mode picker (`mock` or `real`), a free-text intent (default
"Find a weekend trip to Amsterdam under EUR 350 with a flexible rail ticket.") and two buttons:
**Run governed mock** / **Check real availability**, then **Confirm offer and open Drop-in**. The
settings page posts `label`, `apiKey`, `merchantAccount`, `clientKey`, `hmacKey` and
`agenticBearerToken` to `POST /api/profiles`; the last two are optional, and the bearer field is
explicitly a placeholder for a future adapter.

Deployment variables: `PUBLIC_ORIGIN` anchors CSRF and the session return URL,
`PROFILE_ENCRYPTION_KEY` is required on Render or Deno Deploy, `SESSION_SIGNING_SECRET` signs the
cookies, `PORT` defaults to 8000, `DATABASE_PATH` to `./data/agentic.sqlite`, and
`PLAYGROUND_BASIC_AUTH_*` adds Basic Auth. The Render service is on the free plan with no disk, so
it cold-starts and keeps nothing between deploys. The platform also serves `GET /api/health` and
`GET /healthz`.

## Outputs

### Pages

| Path           | What                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| `/`            | Intent, selected offer, the five-step trace, and the separate human-confirmed checkout |
| `/history`     | Run table in compact form                                                              |
| `/back-office` | Run table plus the selected run's timeline                                             |
| `/settings`    | Profiles, capabilities and the encrypted-profile form, with the bearer-token boundary  |
| `/wiki`        | Architecture, mock contract, payment handoff, pilot limits and the production path     |
| `/disclaimer`  | The shared TEST disclaimer                                                             |

### API

| Route                                         | Shape / effect                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/agentic/offers`                     | `{ "offers": [{ "id", "name", "description", "price", "currency", "available", "tags" }] }`                                                                                                                                                                                                                                                               |
| `GET /api/agentic/capabilities`               | `{ "localMock": { "available": true, "execution": "local-deterministic" }, "merchantCatalogue": { "available": true, "execution": "local" }, "humanConfirmedAdyenSession": { "available": true, "execution": "Adyen TEST when configured" }, "realAgenticProvider": { "available": false, "status": "pilot-not-verifiable-in-test", "reason": string } }` |
| `POST /api/agentic/runs`                      | `201 { "correlationId", "run": { "mode": "mock", "intent", "selectedOffer": Offer, "steps": Step[] } }`; `400` for a short intent; `501` for real mode                                                                                                                                                                                                    |
| `POST /api/agentic/runs/:id/checkout-session` | `201 { "correlationId", "session": <Adyen session>, "boundary": { "agenticProviderCalled": false, "adyenCheckoutTestCalled": true, "humanConfirmationRequired": true } }`; `404` unknown/foreign run, `409` wrong flow or missing credentials                                                                                                             |
| `GET /api/agentic/runs`                       | `{ "runs": [{ ...order, "timeline": TimelineEntry[] }] }`                                                                                                                                                                                                                                                                                                 |
| `POST /webhook`                               | `202` text `[accepted]`; `401` when any item fails HMAC or no item is present                                                                                                                                                                                                                                                                             |

Each mock step is
`{ id, name, status: "executed" | "simulated" | "unavailable", system: "playground" | "merchant-catalogue" | "agent-provider" | "adyen", summary, payload }`:

| Step                     | Status        | System               | What it says                                                                                        |
| ------------------------ | ------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| Intent capture           | `executed`    | `playground`         | The playground accepted the shopper-authored intent.                                                |
| Merchant policy gate     | `executed`    | `playground`         | Local rules checked a 50 000 minor-unit ceiling, availability and the human-confirmation rule.      |
| Offer discovery          | `executed`    | `merchant-catalogue` | A deterministic local catalogue search selected the best tag match.                                 |
| External agent reasoning | `simulated`   | `agent-provider`     | No provider was called; `provider` is null and the proposed action is `request_human_confirmation`. |
| Payment handoff          | `unavailable` | `adyen`              | Agentic payment execution is unavailable; a separate human-confirmed session can be created.        |

The mock run creates the order with flow `agentic-local-mock`, the selected offer's amount and
metadata `{ selectedOfferId, intent, simulated: true }`, and records every step as an `api_calls`
row (with method `LOCAL` and a `system://agentic/...` endpoint). The human-confirmed route creates a
`payment_sessions` row of kind `human-confirmed-checkout` and moves the order to `payment_pending`.
An `AUTHORISATION` webhook with `success=true` moves it to `paid`; any other valid authorisation
moves it to `open`. This app has no capture, refund or ledger.

### Refusals

| Status | When                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- |
| `400`  | Intent shorter than 8 characters                                                                      |
| `401`  | Webhook HMAC invalid, missing or no notification items; optional Basic Auth on `/api/*` if configured |
| `403`  | CSRF token missing/mismatched, or a foreign origin                                                    |
| `404`  | Checkout session for an unknown order, or an order from another app                                   |
| `409`  | Checkout session for a non-mock run, or without a merchant account and a client key                   |
| `429`  | More than 120 requests a minute for one client and path                                               |
| `501`  | Real mode; no external provider is called                                                             |
| `500`  | Adyen rejected `/sessions` or an unexpected error; Hono answers `{ "error", "correlationId" }`        |

## Invariants

| #  | Invariant                                                                                                                                                                             | Test / file                                                                                                        |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1  | Real mode returns `501` and contacts no endpoint, even with the real-mode env flag and a bearer token.                                                                                | `api.ts` real branch; `realAgenticUnavailableReason` in `providers.ts`; [KNOWN_LIMITS](../../docs/KNOWN_LIMITS.md) |
| 2  | The mock calls no provider: offer selection, policy and steps are local, and only repository rows are written.                                                                        | `runLocalAgenticMock` in `providers.ts`; `api.ts`; `AgenticPlayground.tsx`                                         |
| 3  | Offer selection is deterministic: tag intersection, then the fixed `OFFERS` order; the catalogue is three offers.                                                                     | `chooseOffer`, `OFFERS` in `providers.ts`                                                                          |
| 4  | Every step carries one of the three statuses and its system; external reasoning is `simulated` with `provider: null`, never presented as real.                                        | `runLocalAgenticMock` in `providers.ts`; `AgenticPlayground.tsx`                                                   |
| 5  | Only an `agentic-local-mock` order can be handed to checkout, and the confirmation click is the human review; the result is a standard Checkout v72 session, not an Agentic API call. | checkout route in `api.ts`; `AgenticPlayground.tsx`                                                                |
| 6  | The checkout route needs a merchant account and a client key; the boundary object states which system was called.                                                                     | checkout route in `api.ts`; `base-api.ts`                                                                          |
| 7  | A valid `AUTHORISATION` webhook sets `paid` only on `success=true`, otherwise `open`; invalid HMAC or an empty delivery is `401`.                                                     | webhook handler in `api.ts`; `packages/platform/hmac.test.ts`                                                      |
| 8  | TEST only: a LIVE host or client key is refused before any call.                                                                                                                      | `packages/platform/test-only.ts`; `AdyenTestClient` in `packages/platform/adyen.ts`                                |
| 9  | Stored non-default profile secrets are encrypted at rest and never returned; only a `test_` client key reaches the browser.                                                           | `packages/platform/profiles.ts`; `GET /api/bootstrap` in `packages/platform/base-api.ts`                           |
| 10 | Intent is bounded: at least 8 characters after trimming, at most 1000 stored; only the exact mode `real` leaves the mock path.                                                        | `POST /api/agentic/runs` in `api.ts`                                                                               |
| 11 | Every `/api/*` mutation carries the CSRF token; a cross-origin POST is refused even with a valid token.                                                                               | `packages/platform/security.test.ts`; `apiFetch` in `packages/ui/client.ts`                                        |
| 12 | No post-payment state is invented in the browser: `onPaymentCompleted`/`onPaymentFailed` are no-ops, and the Back Office/timeline is the record.                                      | `AgenticPlayground.tsx`; `AgenticBackOffice.tsx`                                                                   |

Only the health route has an app-level integration assertion
([`packages/platform/apps.integration.test.ts`](../../packages/platform/apps.integration.test.ts));
the mock trace is verified by reading `providers.ts` and the API branch, not by a dedicated test.

## Determinism

Deterministic in code. The same intent always selects the same offer (tag matches, then the fixed
`OFFERS` order), and the five steps have fixed names, systems, statuses and summaries. Only ids,
timestamps and the order reference vary. The mock does not call a model, a vendor or Adyen.

Real mode is a fixed refusal, so it is deterministic too. The only non-deterministic path is the
human-confirmed Adyen session and its webhook, which are external Adyen TEST responses; this app
stores and displays them rather than composing them.

## Acceptance checks

```bash
deno fmt --check apps/adyen-agentic-commerce
deno task --cwd apps/adyen-agentic-commerce check
deno task --cwd apps/adyen-agentic-commerce test
deno task build:agentic
deno task dev:agentic
```

Manual pass without credentials: run the default intent in mock mode, see five labelled steps and
the selected offer; switch to real mode and confirm the `501` with no provider call. The
human-confirmed Drop-in is a separate manual pass with a configured TEST profile; without one the
button is disabled and the route would answer `409`.

## Out of scope

- No real agent provider, no OpenAI/Copilot/Google integration, no inferred endpoint or schema, and
  no use of the bearer token beyond storing it and reporting that it is configured.
- No mandate, signed consent, replay protection, liability allocation, fraud decision or dispute
  ownership; those are named as production work in the wiki, not implemented.
- No fulfilment, order management, capture, refund or ledger.
- No post-payment result screen: the Drop-in callbacks are no-ops, so completion is visible in the
  Back Office/timeline, not as a result card.
- No multi-offer comparison, cart, quantity or shipping choice; the run selects one of three fixed
  offers.
- No production/LIVE path, no hosted guarantee that a pilot contract will match this shape, and no
  claim that the mock proves an agentic integration.

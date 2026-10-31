---
type: Component
title: "adyen-ipp-endless-aisle: an in-person basket paid on a TEST terminal"
description: "The Endless Aisle playground: fixed catalogue, Cloud Device payment with an explicit local mock or real TEST terminal path, history, Back Office and Terminal API webhook."
tags: [component, ipp, terminal-api, in-person]
status: stable
scope: component-adyen-ipp-endless-aisle
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - id: app
    resource: ../../apps/adyen-ipp-endless-aisle
    title: "The app's pages, API, islands and components"
  - id: api
    resource: ../../apps/adyen-ipp-endless-aisle/api.ts
    title: Catalogue, payment, cancellation, terminal list and webhook routes
  - id: main
    resource: ../../apps/adyen-ipp-endless-aisle/main.ts
    title: Fresh, Hono and security middleware wiring
  - id: workspace
    resource: ../../apps/adyen-ipp-endless-aisle/islands/TerminalWorkspace.tsx
    title: Basket, mode switch and terminal request UI
  - id: back-office
    resource: ../../apps/adyen-ipp-endless-aisle/islands/TerminalBackOffice.tsx
    title: Transaction list and sanitized timeline
  - id: profiles
    resource: ../../apps/adyen-ipp-endless-aisle/islands/IppProfileManager.tsx
    title: Encrypted terminal profiles and webhook settings
  - id: routes
    resource: ../../apps/adyen-ipp-endless-aisle/routes
    title: Home, history, Back Office, settings, wiki and disclaimer
  - id: layout
    resource: ../../apps/adyen-ipp-endless-aisle/components/Layout.tsx
    title: The shared AppShell wrapper
  - id: client
    resource: ../../apps/adyen-ipp-endless-aisle/client.ts
    title: Browser stylesheet imports
  - id: vite
    resource: ../../apps/adyen-ipp-endless-aisle/vite.config.ts
    title: Fresh and SQLite hotfix plugins
  - id: readme
    resource: ../../apps/adyen-ipp-endless-aisle/README.md
    title: Environment variables, real-mode requirements and deployment
---

# adyen-ipp-endless-aisle

## Intent

The "endless aisle" case: a colleague builds a basket on the shop floor and finishes the sale on a
TEST terminal through Terminal API Cloud (the Cloud Device API). The app exists to show the request
shape and to keep the simulation boundary visible: **Mock mode is the default**, is labelled as a
local simulation everywhere it appears, and calls Adyen not at all. Real TEST mode needs a physical
terminal that is online. Status: in progress (estimated Q4 2026); `deno task dev:ipp` runs it on
port 8002, and it is not presented as a finished reference integration.

## Data sources

| Source                                               | What is read                                                                                                                   | Owner      | Freshness                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------- |
| `CATALOGUE` in `api.ts`                              | Four fixed products (EUR prices, warehouse or another store), never a live inventory                                           | Repository | Shipped with the build             |
| `packages/platform/base-api.ts` `GET /api/bootstrap` | Selected public profile, all profiles, `publicOrigin`, `webhookUrl`                                                            | Platform   | Page load and profile switch       |
| `GET /api/ipp/orders` and `/api/ipp/orders/:id`      | Orders, attempts and the timeline from SQLite                                                                                  | App        | On page load; the UI does not poll |
| `packages/platform/adyen.ts` `connectedDevices`      | Devices connected to the merchant account                                                                                      | Adyen      | Per request                        |
| `packages/platform/adyen.ts` `terminalSync`          | The synchronous Cloud Device payment                                                                                           | Adyen      | Per request                        |
| `POST /webhook`                                      | Terminal API event notifications; optional Basic Auth and header HMAC                                                          | Adyen      | Asynchronous                       |
| `.env` via `packages/platform/config.ts`             | `ADYEN_API_KEY` (Cloud Device credential), `ADYEN_MERCHANT_ACCOUNT`, `ADYEN_TERMINAL_ID`, optional HMAC and webhook Basic Auth | Server     | Boot                               |
| Encrypted profiles in SQLite                         | Alternative TEST profiles, including `terminalId`; secrets are never returned                                                  | App        | On profile change                  |

There is no `ADYEN_CLIENT_KEY`: no card field renders in the browser, because the terminal collects
the card. The hosted service runs on Render's free plan with no disk, so it cold-starts and keeps
nothing between deploys ([README](../../apps/adyen-ipp-endless-aisle/README.md)).

## Inputs

### Pages and HTTP

| Route                                        | Input                                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/ipp/payments`                     | `{ "lines": [{ "productId": string, "quantity": integer }], "mode"?: "mock" \| "real-test" }`. Any `mode` other than the exact string `real-test` is treated as `mock`. |
| `POST /api/ipp/orders/:id/cancel`            | No body. Optional `Idempotency-Key`; the server mints a UUID when absent.                                                                                               |
| `GET /api/ipp/terminals`                     | No body; uses the selected profile.                                                                                                                                     |
| `GET /api/ipp/orders`, `/api/ipp/orders/:id` | No body; the detail reads the order id from the path.                                                                                                                   |
| `POST /webhook`                              | The raw Terminal API JSON body; optional `Authorization: Basic …` and `hmacsignature` headers.                                                                          |

The basket validator (`basketAmount` in `api.ts`) accepts only known `productId`s and an integer
quantity from 1 to 20, and the total must be at least 1 minor unit. It totals the fixed catalogue in
EUR; the client's displayed total is a convenience, the server recomputes it. A mutation on `/api/*`
also needs the CSRF double-submit header; `X-Profile-Id` selects a non-default profile.

The terminal request is built by `terminalRequest` and sent by `terminalSync`:

```jsonc
{
  "SaleToPOIRequest": {
    "MessageHeader": {
      "ProtocolVersion": "3.0",
      "MessageClass": "Service",
      "MessageCategory": "Payment",
      "MessageType": "Request",
      "ServiceID": "<order id without dashes, first 10 chars>",
      "SaleID": "EndlessAisle",
      "POIID": "<profile terminalId>"
    },
    "PaymentRequest": {
      "SaleData": {
        "SaleTransactionID": {
          "TransactionID": "<order reference, first 32 chars>",
          "TimeStamp": "<ISO 8601>"
        }
      },
      "PaymentTransaction": {
        "AmountsReq": {
          "Currency": "EUR",
          "RequestedAmount": 12.34
        }
      }
    }
  }
}
```

`RequestedAmount` is in major units: the minor-unit total is divided by 100. The UI warns that Real
TEST can wait over 150 seconds; `terminalSync` caps the HTTP call at 120 s. Real mode needs the
selected profile to have both `merchantAccount` and `terminalId`, or the route answers `409` before
building the request.

### UI

The home page offers the fixed catalogue, a basket, a profile picker and an execution mode. The mode
starts at `mock`; Real TEST cannot be selected silently, and an incomplete profile disables the
button. The settings page posts `label`, `apiKey`, `merchantAccount`, `terminalId`, `hmacKey`,
`webhookBasicAuthUser` and `webhookBasicAuthPassword` to `POST /api/profiles`; the last three are
optional.

Deployment variables: `PUBLIC_ORIGIN` anchors the CSRF check and the webhook URL,
`PROFILE_ENCRYPTION_KEY` is required on Render or Deno Deploy, `SESSION_SIGNING_SECRET` signs the
cookies, `PORT` defaults to 8000, `DATABASE_PATH` to `./data/ipp.sqlite`, `WEBHOOK_BASIC_AUTH_*` is
the webhook's Basic Auth and `PLAYGROUND_BASIC_AUTH_*` puts the app behind Basic Auth. The platform
also serves `GET /api/health` and `GET /healthz`.

## Outputs

### Pages

| Path           | What                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Catalogue, basket, mode/profile settings, "Start terminal payment" and the result with a link to the correlated Back Office |
| `/history`     | The same transaction table in compact form                                                                                  |
| `/back-office` | Transaction table plus the selected order's sanitized timeline                                                              |
| `/settings`    | Profiles, the webhook URL, and the encrypted-profile form                                                                   |
| `/wiki`        | The Terminal API/Cloud Device notes and the hosted limits                                                                   |
| `/disclaimer`  | The shared TEST disclaimer                                                                                                  |

### API and state

| Output                            | Shape / effect                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ipp/catalogue`          | `{ "products": [{ "id", "name", "price", "currency", "stock" }] }`                                                                                                                  |
| `GET /api/ipp/orders`             | `{ "orders": [{ ...order, "attempts": Attempt[], "timeline": TimelineEntry[] }] }`                                                                                                  |
| `GET /api/ipp/orders/:id`         | `{ "order", "attempts", "timeline" }`, or `404 { "error": "Transaction not found." }`                                                                                               |
| `GET /api/ipp/terminals`          | `{ "correlationId", "response": <connected devices> }`; a failed call is recorded and rethrown as `500`                                                                             |
| `POST /api/ipp/payments`          | `201 { "correlationId", "mode", "response" }`                                                                                                                                       |
| `POST /api/ipp/orders/:id/cancel` | `202 { "actionId", "state": "cancelled" }`; a seen `Idempotency-Key` returns `200 { "duplicate": true, "actionId" }`; `404` unknown order, `409` unless `open` or `payment_pending` |
| `POST /webhook`                   | `202` text `[accepted]`; `400` invalid JSON, `401` invalid Basic Auth or HMAC                                                                                                       |

The mock response is exactly:

```json
{
  "simulated": true,
  "provider": "local-terminal-simulator",
  "status": "Success",
  "message": "No Adyen endpoint was called. Switch explicitly to Real TEST when a connected TEST terminal is available.",
  "serviceId": "<first 10 chars of the order id without dashes>"
}
```

State after each path:

| Path              | Attempt                                      | Order                                                            | Extra                                        |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Creation          | `pending`, payment method `terminal`         | `open`, then `payment_pending`                                   | Order metadata holds lines, profile id, mode |
| Mock              | `authorised`, `MOCK-<12 chars of order id>`  | `paid`, `paidValue` = total                                      | Payment part and an `audit_log` row          |
| Real success      | `authorised`, terminal `POITransactionID`    | `paid`, `paidValue` = total                                      | No payment part is written                   |
| Real refusal      | `refused`, `refusalReason` = terminal result | `open`, `paidValue` 0 (a refusal ends an attempt, not the order) | API call recorded                            |
| Transport failure | `error`, message in `refusalReason`          | `failed`                                                         | Route rethrows, so the client sees `500`     |

The real response is stored and returned through `sanitize`. Cancellation records a
`lifecycle_actions` row and moves the order to `cancelled`; it does **not** send a live abort to the
terminal, because that behavior depends on the device transaction state.

## Invariants

| #  | Invariant                                                                                                                                               | Test / file                                                                                                              |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1  | Mock mode makes no Adyen call and is labelled as a local simulation in the UI, the response and the audit row.                                          | `ippPaymentHandler` in `api.ts`; `TerminalWorkspace.tsx`; [KNOWN_LIMITS](../../docs/KNOWN_LIMITS.md)                     |
| 2  | Real TEST never falls back silently to mock: the mode is explicit, and missing `merchantAccount`/`terminalId` gives `409`.                              | `ippPaymentHandler` in `api.ts`; `TerminalWorkspace.tsx`                                                                 |
| 3  | The total comes only from the fixed catalogue and validated quantities; unknown products, non-integer quantities, 0/21 and an empty basket are refused. | `basketAmount` in `api.ts`                                                                                               |
| 4  | The amount is EUR minor units; the terminal request converts to major units exactly once.                                                               | `basketAmount`, `terminalRequest` in `api.ts`                                                                            |
| 5  | TEST only: a LIVE credential or endpoint is refused before any call.                                                                                    | `packages/platform/test-only.ts`; `AdyenTestClient` in `packages/platform/adyen.ts`                                      |
| 6  | Forged webhook item: HMAC is checked when a key is configured; Basic Auth is checked when a user/password pair exists; either failure is `401`.         | `basicAuthValid`, `verifyHeaderHmac` in `api.ts`; `packages/platform/hmac.test.ts`; `packages/platform/security.test.ts` |
| 7  | Every webhook item is stored with its HMAC verdict and deduplicated; an invalid item cannot change an order.                                            | `dedupeKey` and `recordWebhook` in `api.ts`; `packages/platform/storage.test.ts`                                         |
| 8  | A terminal webhook is recorded but does not change an order's state; the synchronous response is the outcome in this app.                               | webhook handler in `api.ts`                                                                                              |
| 9  | Cancellation is idempotent by `Idempotency-Key`, only for `open`/`payment_pending`, and audits that it changed local state only.                        | cancel route in `api.ts`; `recordAction` in `packages/platform/storage.ts`, `storage.test.ts`                            |
| 10 | Every stored timeline payload is sanitized before it is written.                                                                                        | `json()` in `packages/platform/storage.ts`; `packages/platform/sanitize.test.ts`                                         |
| 11 | A hosted deployment cannot make a terminal reachable; real mode depends on Adyen and the device, not on this server.                                    | [README](../../apps/adyen-ipp-endless-aisle/README.md); [KNOWN_LIMITS](../../docs/KNOWN_LIMITS.md)                       |
| 12 | Every `/api/*` mutation carries the CSRF token; a cross-origin POST is refused even with a valid token.                                                 | `packages/platform/security.test.ts`; `apiFetch` in `packages/ui/client.ts`                                              |

## Determinism

Deterministic in code for the mock: a fixed catalogue, a fixed request shape and a fixed simulated
response. The only varying values are generated ids, timestamps and the order reference. The real
path is not deterministic in that sense: the terminal's result is external input, parsed by
`terminalResult` and stored, never composed by this app. No model is involved.

The UI reads history once at mount; it does not poll, so a webhook arriving later is visible only
after a reload. The timeline is the record, not a live view.

## Acceptance checks

```bash
deno fmt --check apps/adyen-ipp-endless-aisle
deno task --cwd apps/adyen-ipp-endless-aisle check
deno task --cwd apps/adyen-ipp-endless-aisle test
deno task build:ipp
deno task dev:ipp
```

Manual pass without credentials: add catalogue items, run **Local realistic mock**, see the result
labelled `local-terminal-simulator`, open the Back Office and confirm the timeline has the simulated
API call. Real TEST is a separate manual pass that needs an online terminal, the POS merchant
account and the exact POIID; without them the correct result is the `409`, not a mock.

## Out of scope

- No live abort on cancellation, no retry of a timed-out synchronous call, and no asynchronous
  completion of a `payment_pending` order when a webhook arrives.
- No capture, refund, reconciliation or ledger; the Back Office is a request/timeline viewer.
- No live inventory, pricing, tax or stock reservation: the catalogue is four fixed EUR products.
- No card fields, client key, Adyen Web checkout or shopper-facing payment UI; the terminal collects
  the card.
- No queue, background job or hosted ability to wake a terminal; a disconnected terminal simply does
  not answer.
- The UI's "over 150 seconds" warning and the 120 s HTTP timeout are both stated, not reconciled.

---
type: Component
title: "adyen-digital: Digital Checkout"
description: "Pages, API endpoints and islands of the online checkout playground (Sessions, Advanced, API only, MIT, Pay by Link) and its Back Office."
tags: [component, digital, api, islands]
status: stable
scope: component-adyen-digital
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: api
    resource: apps/adyen-digital/api.ts
    title: Every digital API route
  - id: workbench
    resource: apps/adyen-digital/islands/FlowWorkbench.tsx
    title: Checkout and inspector island
  - id: routes
    resource: apps/adyen-digital/routes
    title: Pages
  - id: readme
    resource: apps/adyen-digital/README.md
    title: Environment variables and quick start
---

# adyen-digital

Online checkout against Adyen TEST, with a Back Office that correlates what each flow produced.
Production: `https://digital.payments-playground.com`. Status: in progress (README). What is
verified today: [current/digital-status.md](../current/digital-status.md).

## Pages

| Path                                                          | What                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                           | Flow picker                                                                                                              |
| `/sessions`, `/advanced`, `/api-only`, `/mit`, `/pay-by-link` | `routes/[flow].tsx`. `?integration=dropin` (default) or `component`. Bootstrap is fetched in-process before first paint. |
| `/back-office`                                                | Orders, attempts, timeline, capture/cancel/refund with the reason an action is refused                                   |
| `/settings`                                                   | TEST profiles (encrypted)                                                                                                |
| `/wiki`                                                       | In-app notes on each flow                                                                                                |
| `/result`                                                     | Redirect return page (`returnUrl`), links to the order                                                                   |
| `/disclaimer`                                                 | TEST-only disclaimer                                                                                                     |

## API

Shared routes from `base-api.ts`: `GET /api/health`, `GET /healthz`, `GET /api/bootstrap`,
`GET|POST /api/profiles`, `POST /api/profiles/preferred`, `DELETE /api/profiles/:id`,
`POST /api/callbacks`, `GET /api/timeline/:correlationId`.

| Route                                                                 | Calls Adyen                                      | Notes                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `POST /api/digital/sessions`                                          | `/sessions`                                      | Creates the order and its session row                                         |
| `POST /api/digital/sessions/:orderId/result`                          | `GET /sessions/{id}?sessionResult=`              | Writes the Sessions outcome                                                   |
| `POST /api/digital/payment-methods`                                   | `/paymentMethods`                                | Mints `shopperConversionId`                                                   |
| `POST /api/digital/payments`                                          | `/payments`                                      | Creates order and attempt; forwards selected `state.data`                     |
| `POST /api/digital/payments/details`                                  | `/payments/details`                              | Settles the pending attempt                                                   |
| `POST /api/digital/api-only`                                          | via `/api/digital/payments`                      | Rejects raw card data first                                                   |
| `POST /api/digital/mit`                                               | `/payments` (`ContAuth`)                         | Needs a `storedPaymentMethodId` and the shopper reference it was stored under |
| `POST /api/digital/payment-links`                                     | `/paymentLinks`                                  | Validity 1 h to 70 days                                                       |
| `GET /api/digital/payment-links/:orderId`                             | `GET /paymentLinks/{id}`                         | Re-derives the order from the link status                                     |
| `POST /api/digital/partial-orders`                                    | `/orders`                                        | No client flow uses it yet                                                    |
| `POST /api/digital/orders/:id/actions/:action`                        | `/payments/{psp}/captures`, `cancels`, `refunds` | `Idempotency-Key` header                                                      |
| `GET /api/digital/orders`, `GET /api/digital/orders/:id`              |                                                  | Orders with attempts and permissions                                          |
| `POST /webhook`                                                       |                                                  | Standard notifications, HMAC-checked                                          |
| `GET /api/digital/config`, `GET /api/digital/webhooks/:correlationId` |                                                  | Capabilities and webhook rows                                                 |

Every mutation needs the CSRF double-submit token (`packages/ui/client.ts` adds it) and, when
several profiles exist, `X-Profile-Id`. `returnUrl` and the 3DS `origin` follow the browser's
same-host Origin ([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## Islands

- **`FlowWorkbench.tsx`**: mounts Drop-in, a single Component or the API-only Custom Card; starts on
  load and restarts 500 ms after any scenario change (market, locale, amount, integration, profile).
  A run counter stops a slow, superseded start from mounting a second checkout. Callbacks are
  reported to the server under the current run's correlation id (a ref, not render state). Card
  callbacks (`onBinLookup`, `onBinValue`, `onBrand`) are set on the `card`/`scheme` configuration,
  where Adyen Web reads them. The inspector (callbacks, API calls, webhooks) never opens on its own.
- **`BackOffice.tsx`**: order list (10 per page, 7 pages), timeline, lifecycle buttons.
- **`ProfileManager.tsx`**: add, select and delete TEST profiles.

Markets: 36 countries, each with its own currency, locale and default amount
(`packages/platform/markets.ts`); installments are offered in BR, MX and JP.

---
type: Component
title: "adyen-digital: Digital Checkout"
description: "Pages, API endpoints and islands of the online checkout playground (Sessions, Advanced, API only, MIT, Pay by Link) and its Back Office."
tags: [component, digital, api, islands]
status: stable
scope: component-adyen-digital
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T06:30:00Z
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
  - id: components
    resource: apps/adyen-digital/components
    title: Flow list, status wording, sheet, timeline, result card
  - id: readme
    resource: apps/adyen-digital/README.md
    title: Environment variables and quick start
---

# adyen-digital

Online checkout against Adyen TEST, with a Back Office that correlates what each flow produced.
Production: `https://digital.payments-playground.com`. Status: in progress (README). What is
verified today: [current/digital-status.md](../current/digital-status.md).

## Pages

| Path                                                          | What                                                                                                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                           | Only the flow tiles, grouped as checkout flows and beyond checkout (`components/flows.ts`); width and type scale with the viewport up to a cap, centred between header and footer |
| `/sessions`, `/advanced`, `/api-only`, `/mit`, `/pay-by-link` | `routes/[flow].tsx`. `?integration=dropin` (default) or `component`. Bootstrap is fetched in-process before first paint.                                                          |
| `/back-office`                                                | Orders in plain words, search and filters, detail with capture/cancel/refund and the reason an action is refused                                                                  |
| `/settings`                                                   | Connection (profile, merchant account, client key, webhook HMAC key set or not, webhook URL to copy) and the TEST profiles                                                        |
| `/wiki`                                                       | In-app notes on each flow                                                                                                                                                         |
| `/result`                                                     | `returnUrl` of every payment: submits the `redirectResult` so a redirect method settles the order, then shows the result; without one, polls the order                            |
| `/disclaimer`                                                 | TEST-only disclaimer                                                                                                                                                              |

## API

Shared routes from `base-api.ts`: `GET /api/health`, `GET /healthz`, `GET /api/bootstrap`,
`GET|POST /api/profiles`, `POST /api/profiles/preferred`, `DELETE /api/profiles/:id`,
`POST /api/callbacks`, `GET /api/timeline/:correlationId`.

| Route                                                                 | Calls Adyen                                      | Notes                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `POST /api/digital/sessions`                                          | `/sessions`                                      | Creates the order and its session row                                                                        |
| `POST /api/digital/sessions/:orderId/result`                          | `GET /sessions/{id}?sessionResult=`              | Writes the Sessions outcome                                                                                  |
| `POST /api/digital/payment-methods`                                   | `/paymentMethods`                                | Mints `shopperConversionId`                                                                                  |
| `POST /api/digital/payments`                                          | `/payments`                                      | Creates order and attempt; forwards selected `state.data`                                                    |
| `POST /api/digital/payments/details`                                  | `/payments/details`                              | Settles the pending attempt                                                                                  |
| `POST /api/digital/orders/:id/redirect-result`                        | `/payments/details`                              | Redirect return; creates the attempt for Sessions; a reload reads the stored outcome instead of resubmitting |
| `POST /api/digital/api-only`                                          | via `/api/digital/payments`                      | Rejects raw card data first                                                                                  |
| `POST /api/digital/mit`                                               | `/payments` (`ContAuth`)                         | Needs a `storedPaymentMethodId` and the shopper reference it was stored under                                |
| `POST /api/digital/payment-links`                                     | `/paymentLinks`                                  | Validity 1 h to 70 days                                                                                      |
| `GET /api/digital/payment-links/:orderId`                             | `GET /paymentLinks/{id}`                         | Re-derives the order from the link status                                                                    |
| `POST /api/digital/partial-orders`                                    | `/orders`                                        | No client flow uses it yet                                                                                   |
| `POST /api/digital/orders/:id/actions/:action`                        | `/payments/{psp}/captures`, `cancels`, `refunds` | `Idempotency-Key` header                                                                                     |
| `GET /api/digital/orders`, `GET /api/digital/orders/:id`              |                                                  | Orders with attempts and permissions                                                                         |
| `POST /webhook`                                                       |                                                  | Standard notifications, HMAC-checked                                                                         |
| `GET /api/digital/config`, `GET /api/digital/webhooks/:correlationId` |                                                  | Capabilities and webhook rows                                                                                |

Every mutation needs the CSRF double-submit token (`packages/ui/client.ts` adds it) and, when
several profiles exist, `X-Profile-Id`. `returnUrl` and the 3DS `origin` follow the browser's
same-host Origin ([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## Islands

- **`FlowWorkbench.tsx`**: one row on top: the flow as a rounded badge (the page's `h1`) and a
  scenario chip (flag, market, amount, integration) that opens the configuration sheet; then the
  order summary and the checkout. Switching flow goes through Home. Mounts Drop-in, a single
  Component or the API-only Custom Card; starts on load and restarts 500 ms after any scenario or
  theme change. A run counter stops a slow, superseded start from mounting a second checkout.
  Callbacks are reported under the current run's correlation id (a ref, not render state). Card
  callbacks (`onBinLookup`, `onBinValue`, `onBrand`) are set on the `card`/`scheme` configuration,
  where Adyen Web reads them. The result card replaces the checkout once a payment ends. Test cards
  and the inspector open in sheets (right on desktop, bottom on mobile); the inspector never opens
  on its own.
- **`BackOffice.tsx`**: metrics (Authorised, Captured, Refused, Not paid), search by reference or
  PSP reference, state filters, orders nobody tried to pay hidden by default, 12 per page with "Show
  more", refresh every 4 s. The detail shows the allowed actions first and why the others are
  refused.
- **`ProfileManager.tsx`**: the Connection card, then add, select and delete TEST profiles.
- **`RedirectReturn.tsx`**: the `/result` island.

## Shared pieces (`components/`)

- `status.ts`: plain-language labels for order and attempt states. `payment_pending` reads
  "Authorised, awaiting capture", or "Captured" when the method captures on authorisation (refund
  already allowed).
- `Timeline.tsx`: the inspector and Back Office timeline: one-line summaries, consecutive `onChange`
  grouped, filter chips, request and response with copy.
- `Sheet.tsx`, `ResultCard.tsx`, `TestData.tsx`, `FlowIcon.tsx` (one icon per flow, tiles and
  badge), `flows.ts`.

Markets: 36 countries, each with its own currency, locale and default amount
(`packages/platform/markets.ts`); installments are offered in BR, MX and JP.

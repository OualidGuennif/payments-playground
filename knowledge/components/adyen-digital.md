---
type: Component
title: "adyen-digital: Digital Checkout"
description: "Pages, API endpoints and islands of the online checkout playground (Sessions, Advanced, API only, MIT, Pay by Link) and its Back Office."
tags: [component, digital, api, islands]
status: stable
scope: component-adyen-digital
generated:
  by: claude-code/opus-5.5
  at: 2026-10-16T18:20:00Z
sources:
  - id: api
    resource: ../../apps/adyen-digital/api.ts
    title: Every digital API route
  - id: workbench
    resource: ../../apps/adyen-digital/islands/FlowWorkbench.tsx
    title: Checkout and inspector island
  - id: routes
    resource: ../../apps/adyen-digital/routes
    title: Pages
  - id: components
    resource: ../../apps/adyen-digital/components
    title: Flow list, status wording, sheet, timeline, result card
  - id: readme
    resource: ../../apps/adyen-digital/README.md
    title: Environment variables and quick start
---

# adyen-digital

Online checkout against Adyen TEST, with a Back Office that correlates what each flow produced.
Production: `https://digital.payments-playground.com`. Status: Ready (README, since 2026-10-10).
What is verified today: [current/digital-status.md](../current/digital-status.md).

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

| Route                                                                 | Calls Adyen                                      | Notes                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/digital/sessions`                                          | `/sessions`                                      | Creates the order and its session row; both expire after 25 minutes (`expiresAt`, owner 2026-10-16)                                            |
| `POST /api/digital/payment-methods`                                   | `/paymentMethods`                                | Mints `shopperConversionId`; takes an Adyen `order` (`orderData`, `pspReference`) after a partial payment                                      |
| `POST /api/digital/payments`                                          | `/payments`                                      | Creates order and attempt; forwards selected `state.data`. With `orderId` and an Adyen `order`, charges the share sent (at most the order)     |
| `POST /api/digital/payments/details`                                  | `/payments/details`                              | Settles the pending attempt                                                                                                                    |
| `POST /api/digital/orders/:id/redirect-result`                        | `/payments/details`                              | Redirect return; creates the attempt for Sessions; a reload reads the stored outcome instead of resubmitting                                   |
| `POST /api/digital/api-only`                                          | via `/api/digital/payments`                      | Rejects raw card data first                                                                                                                    |
| `POST /api/digital/mit`                                               | `/payments` (`ContAuth`)                         | Needs a `storedPaymentMethodId` and the shopper reference it was stored under                                                                  |
| `POST /api/digital/payment-links`                                     | `/paymentLinks`                                  | Validity 1 h to 70 days                                                                                                                        |
| `GET /api/digital/payment-links/:orderId`                             | `GET /paymentLinks/{id}`                         | Re-derives the order from the link status                                                                                                      |
| `POST /api/digital/gift-card-balance`                                 | `/paymentMethods/balance`                        | Advanced `onBalanceCheck`; the card number arrives encrypted                                                                                   |
| `POST /api/digital/partial-orders`                                    | `/orders`                                        | Advanced `onOrderRequest`; creates the server order every payment of the split goes into                                                       |
| `POST /api/digital/partial-orders/:id/cancel`                         | `/orders/cancel`                                 | Advanced `onOrderCancel` (Drop-in's « Supprimer » on a paid gift card)                                                                         |
| `POST /api/digital/orders/:id/actions/:action`                        | `/payments/{psp}/captures`, `cancels`, `refunds` | Optional `amount` (partial). `Idempotency-Key` per intent: a known key returns the stored request; 409 while a webhook of that kind is awaited |
| `GET /api/digital/orders`, `GET /api/digital/orders/:id`              |                                                  | Orders with attempts and permissions                                                                                                           |
| `POST /webhook`                                                       |                                                  | Standard notifications, HMAC-checked                                                                                                           |
| `GET /api/digital/config`, `GET /api/digital/webhooks/:correlationId` |                                                  | Capabilities and webhook rows                                                                                                                  |

Every mutation needs the CSRF double-submit token (`packages/ui/client.ts` adds it) and, when
several profiles exist, `X-Profile-Id`. `returnUrl` and the 3DS `origin` follow the browser's
same-host Origin ([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## Islands

- **`FlowWorkbench.tsx`**: one row on top: the flow as a rounded badge (the page's `h1`) and a
  scenario chip (flag, market, amount, integration) that opens the configuration sheet; then the
  checkout, with the inspector beside it (under it on a phone). Switching flow goes through Home.
  Mounts Drop-in, a single Component or the API-only Custom Card; starts on load and restarts 500 ms
  after any scenario or theme change. A run counter stops a slow, superseded start from mounting a
  second checkout. Callbacks are reported under the current run's correlation id (a ref, not render
  state). Card callbacks (`onBinLookup`, `onBinValue`, `onBrand`) are set on the `card`/`scheme`
  configuration, where Adyen Web reads them. The result card replaces the checkout once a payment
  ends. Test cards open in a sheet. The settings sheet has a "Native 3DS" switch for Sessions and
  Advanced, on by default; off sends `nativeThreeDS: "disabled"` and the scenario chip adds "3DS
  redirect" (owner, 2026-10-15). Partial payments (a gift card, then a card): `onOrderUpdated` is
  recorded and, with Components, shows a "Partial payment … paid · … left to pay" banner and mounts
  the card for the rest (Drop-in shows its own); Advanced also implements `onBalanceCheck`,
  `onOrderRequest`, `onOrderCancel` and `onPaymentMethodsRequest`, and sends each payment's share
  (`components/partial.ts`: a gift card pays what its balance covers, the next method the rest).
  After a refused, cancelled or failed payment the result card offers "Try again": it remounts on
  the same AdyenCheckout instance, so the session (with its latest `sessionData`) and any gift card
  order survive; "New payment" starts a new session, and so does a retry after the fifth refusal in
  a session, a `14_0422`/`14_0423` answer, or once the session expired (the card says so). The
  inspector is open from the start (owner, 2026-10-10), polls the timeline every 2.5 s ("Live") and
  follows new events unless the reader scrolled up. Only Adyen Web callbacks are recorded from the
  browser: the playground no longer posts its own responses (`sessionCreated`,
  `backendPaymentResponse`, `paymentLinkCreated`, `mitResponse`) as callbacks.
- **`BackOffice.tsx`**: metrics (Authorised, Captured, Refused, Not paid), search by reference or
  PSP reference, state filters, orders nobody tried to pay hidden by default, 12 per page with "Show
  more", refresh every 4 s. The detail holds `LifecyclePanel.tsx`: a warning when the account
  captures the method manually, the ledger (authorised, captured, refunded, pending), capture and
  refund with an editable amount where partial is allowed, a disabled "Waiting for the ... webhook"
  button while one is awaited, why the other actions are refused, and every capture, cancel and
  refund with its outcome, PSP reference and Idempotency-Key.
- **`ProfileManager.tsx`**: the Connection card, then add, select and delete TEST profiles.
- **`RedirectReturn.tsx`**: the `/result` island.

## Shared pieces (`components/`)

- `status.ts`: plain-language labels for order and attempt states. `payment_pending` reads
  "Authorised, awaiting capture", or "Captured" when the method captures on authorisation (refund
  already allowed).
- `Timeline.tsx`: the inspector and Back Office timeline. Only what Adyen produced: Adyen Web
  callbacks (SDK), Checkout API calls and webhooks; Back Office action rows and older playground
  rows are left out. Every `onChange` is its own row, summarised by what moved since the previous
  one (`onChangeDiff.ts`). Rows carry the time since the first event, HTTP status, duration and
  result; filters with counts, search over names and payloads, Copy all, Export as JSON, Clear. The
  detail has Request/Response (API; Response opens first), each in its own colour (request blue,
  response green, red on an error) with a header naming the direction and HTTP status,
  Changes/Payload (`onChange`), coloured JSON with long values folded, Copy JSON and Copy cURL
  (`curl.ts`, API key left to `$ADYEN_API_KEY`).
- `onChangeDiff.ts`, `curl.ts`, `read.ts`: the pure parts of the timeline, with tests.
- `status.ts` labels an authorised payment from its ledger: Authorised, Capture requested, Partially
  captured, Captured, Refund requested, Partially refunded, Refunded, Cancelled.
- `Sheet.tsx`, `ResultCard.tsx`, `TestData.tsx`, `FlowIcon.tsx` (one icon per flow, for the checkout
  badge), `flows.ts`.

Markets: 36 countries, each with its own currency, locale and default amount
(`packages/platform/markets.ts`); installments are offered in BR, MX and JP.

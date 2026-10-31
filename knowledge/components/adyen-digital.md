---
type: Component
title: "adyen-digital: online checkout playground"
description: "Pages, API routes and islands of the online checkout playground (Sessions, Advanced, API only, MIT, Pay by Link) and the Back Office that correlates what each flow produced."
tags: [component, digital, api, islands]
status: stable
scope: component-adyen-digital
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - resource: ../../apps/adyen-digital
    title: "The app's pages, API, islands and components"
  - resource: ../../apps/adyen-digital/main.ts
    title: "Fresh app, optional Basic Auth, API hand-off, security headers"
  - resource: ../../apps/adyen-digital/api.ts
    title: "Every digital API route"
  - resource: ../../apps/adyen-digital/client.ts
    title: "Stylesheet entry point"
  - resource: ../../apps/adyen-digital/vite.config.ts
    title: "Vite and Fresh plugin configuration"
  - resource: ../../apps/adyen-digital/islands/FlowWorkbench.tsx
    title: "Checkout and inspector island"
  - resource: ../../apps/adyen-digital/routes
    title: "Pages"
  - resource: ../../apps/adyen-digital/components
    title: "Flow list, status wording, sheet, timeline, result card"
  - resource: ../../apps/adyen-digital/README.md
    title: "Environment variables and quick start"
---

# adyen-digital

## Intent

Online checkout against Adyen TEST that demonstrates five integration paths (Sessions, Advanced, API
only, MIT and Pay by Link), with a Back Office that correlates every callback, API call and webhook
an order produced. It is deployed at `https://digital.payments-playground.com` and listed as Ready
in the [README](../../README.md) since 2026-10-10 (commit `8678cc9`); what is verified today is in
[current/digital-status.md](../current/digital-status.md).

## Data sources

| Source                                                                                  | What is read                                                                                                 | Owner      | Freshness                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------ |
| Adyen TEST Checkout API v72 (`packages/platform/adyen.ts`)                              | session, payment methods, payment, details, order, balance, payment-link and modification answers            | Adyen      | per request              |
| Standard webhooks, `POST /webhook`                                                      | AUTHORISATION, CAPTURE, CAPTURE_FAILED, CANCELLATION, REFUND, REFUND_FAILED, REFUNDED_REVERSED, ORDER_CLOSED | Adyen      | asynchronous, on arrival |
| SQLite at `DATABASE_PATH` (default `./data/digital.sqlite`)                             | orders, sessions, attempts, parts, API calls, callbacks, webhooks, actions, audit                            | this app   | immediate, WAL           |
| Environment and stored profiles                                                         | TEST credentials, `PUBLIC_ORIGIN`, profile encryption key                                                    | operator   | boot, on profile change  |
| `packages/platform/markets.ts`                                                          | 36 markets: currency, locale, default amount; zero-decimal currencies                                        | repository | static                   |
| `packages/platform/payment-methods.ts`, `lifecycle.ts`, `packages/ui/paymentMethods.ts` | per-method capabilities, link and partial-order validity, installment countries                              | repository | static                   |
| Browser (Adyen Web 6.47.0 and this island)                                              | shopper choices, Adyen Web callbacks, `redirectResult`                                                       | browser    | per event                |
| [current/digital-status.md](../current/digital-status.md)                               | what was verified, at which level                                                                            | docs       | per verification         |

## Inputs

**Pages** (`apps/adyen-digital/routes`).

| Route                                                         | Accepts                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                           | nothing; flow tiles grouped as checkout and beyond checkout (`components/flows.ts`)                                             |
| `/sessions`, `/advanced`, `/api-only`, `/mit`, `/pay-by-link` | the flow id in the path; `?integration=dropin` (default) or `component` on the two flows that offer both; any other flow is 404 |
| `/back-office`                                                | `?orderId=<order id>`, which selects that order in the list                                                                     |
| `/settings`, `/wiki`, `/disclaimer`                           | nothing                                                                                                                         |
| `/result`                                                     | `?orderId=<order id>` and optionally `?redirectResult=...`; it is the `returnUrl` of every payment                              |

**API requests.** Shared routes from `packages/platform/base-api.ts`: `GET /api/health`,
`GET /healthz`, `GET /api/bootstrap`, `GET /api/profiles`, `POST /api/profiles`
(`{label, secrets}`), `POST /api/profiles/preferred` (`{profileId}`), `DELETE /api/profiles/:id`,
`POST /api/callbacks` (`{correlationId, name, payload?, occurredAt?}`) and
`GET /api/timeline/:correlationId`. Digital routes:

| Route                                                                 | Fields read from the body (or query)                                                                                                   | Calls Adyen                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `POST /api/digital/sessions`                                          | `flow` (default `sessions-dropin`), `amount`, `countryCode`, `shopperLocale`, `installments`, `allowedPaymentMethods`, `nativeThreeDS` | `/sessions`                                      |
| `POST /api/digital/payment-methods`                                   | `amount`, `countryCode`, `shopperLocale`, `shopperEmail`, `correlationId`, `shopperConversionId`, `order`                              | `/paymentMethods`                                |
| `POST /api/digital/payments`                                          | `orderId`, `flow`, `amount`, `countryCode`, `shopperLocale`, `shopperEmail`, `nativeThreeDS`, `paymentMethod`, `browserInfo`, `order`  | `/payments`                                      |
| `POST /api/digital/payments/details`                                  | `correlationId`, `details`, `paymentData`                                                                                              | `/payments/details`                              |
| `POST /api/digital/orders/:id/redirect-result`                        | `redirectResult`                                                                                                                       | `/payments/details`                              |
| `POST /api/digital/api-only`                                          | same as `/payments`, after the raw-card and encrypted-value check                                                                      | via `/api/digital/payments`                      |
| `POST /api/digital/mit`                                               | `amount`, `storedPaymentMethodId`, `shopperReference`, `recurringProcessingModel`                                                      | `/payments` (`ContAuth`)                         |
| `POST /api/digital/payment-links`                                     | `amount`, `countryCode`, `shopperLocale`, `validityHours`, `reusable`, `description`, `requiredShopperFields`                          | `/paymentLinks`                                  |
| `GET /api/digital/payment-links/:orderId`                             | the order id in the path                                                                                                               | `GET /paymentLinks/{id}`                         |
| `POST /api/digital/gift-card-balance`                                 | `correlationId`, `amount`, `paymentMethod`                                                                                             | `/paymentMethods/balance`                        |
| `POST /api/digital/partial-orders`                                    | `amount`                                                                                                                               | `/orders`                                        |
| `POST /api/digital/partial-orders/:id/cancel`                         | `order`                                                                                                                                | `/orders/cancel`                                 |
| `POST /api/digital/orders/:id/actions/:action`                        | `Idempotency-Key` header; optional `amount` for capture and refund                                                                     | `/payments/{psp}/captures`, `cancels`, `refunds` |
| `GET /api/digital/orders`, `GET /api/digital/orders/:id`              | none, and the order id on the detail route                                                                                             | none                                             |
| `POST /webhook`                                                       | a standard notification, single item or `notificationItems`                                                                            | none                                             |
| `GET /api/digital/config`, `GET /api/digital/webhooks/:correlationId` | the correlation id in the path                                                                                                         | none                                             |

Shapes the routes rely on:

- `amount: {value, currency}`; `value` is an integer in minor units from 1 to 100000000, `currency`
  an ISO 4217 code defaulting to `EUR`. Anything else is refused with 400.
- `countryCode` is ISO alpha-2 and defaults to `FR`; `shopperLocale` defaults to `en-US`;
  `shopperEmail` is resolved server-side; `billingAddress` and `deliveryAddress` are built by
  `buildCheckoutAddresses` (`packages/platform/addresses.ts`), and only `/sessions` puts names in
  `deliveryAddress` (`firstName`/`lastName`, default `Test`/`Shopper`).
- `order` is Adyen's `{orderData, pspReference}` pair; only those two fields are trusted, and a
  payment into it may not exceed the order (400 "A partial payment cannot exceed its order."). After
  a partial payment, `/payment-methods` takes it too.
- `nativeThreeDS` is on unless it is exactly `false`; then both `/sessions` and `/payments` send
  `nativeThreeDS: "disabled"` and the scenario chip reads "3DS redirect" (owner, 2026-10-15).
- `POST /payments` forwards only an allowlist of `state.data` beside the payment method: `riskData`,
  `installments`, `socialSecurityNumber`, `shopperName`, `telephoneNumber`, `dateOfBirth`. It also
  reads `storePaymentMethod`, `shopperInteraction`, `recurringProcessingModel` and a
  `shopperConversionId` minted by `/payment-methods`.
- `validityHours` is clamped to 1 hour through 70 days; `description` is cut to 280 characters;
  `requiredShopperFields` defaults to `["shopperEmail", "billingAddress", "deliveryAddress"]`.
- The island labels orders `sessions-<integration>`, `advanced-<integration>` and `api-only-pci`;
  the server adds `pay-by-link`, `mit` and `partial-payment`.
- `storedPaymentMethodId` and the `shopperReference` the card was stored under (at least 3
  characters) are required for MIT; `recurringProcessingModel` is `Subscription` or
  `UnscheduledCardOnFile`.
- `redirectResult` is a single-use string; `details` is Adyen's action payload.
- An action's `amount` is an integer from 1 to what the permission allows, and the full amount when
  the method does not support partials.

**Browser callbacks.** The island sends Adyen Web callbacks to `POST /api/callbacks` under the
current run's correlation id: `onChange`, `onSubmit`, `beforeSubmit`, `onAdditionalDetails`,
`onPaymentCompleted`, `onPaymentFailed`, `onOrderUpdated`, `onError`, `onBinLookup`, `onBinValue`,
`onBrand`; Advanced also reports `onBalanceCheck`, `onOrderRequest`, `onOrderCancel` and
`onPaymentMethodsRequest`, and the API-only Custom Card reports `onLoad`, `onConfigSuccess`,
`onBrand` and `onValidationError`. Gift-card details arrive encrypted, and `/paymentMethods/balance`
is Advanced's `onBalanceCheck`. Card callbacks are configured on `card`, `scheme` and `storedCard`,
where Adyen Web reads them. Only Adyen Web callbacks are recorded: the playground no longer posts
its own responses (`sessionCreated`, `backendPaymentResponse`, `paymentLinkCreated`, `mitResponse`).

**Scenario fields.** The settings sheet edits country (36 markets), locale, currency, amount (shown
in major units, sent in minor units), the integration (Drop-in or Components), Native 3DS for
Sessions and Advanced, and the credential profile; Pay by Link adds validity (1 h, 24 h, 7 d, 30 d,
70 d) and reusable, MIT adds the saved method, the recurring model and an optional token or shopper
reference. Installments are offered by market (BR, MX, JP), not by a switch.

Every mutation under `/api/*` needs the CSRF double-submit token (`packages/ui/client.ts` adds it)
and, when several profiles exist, `X-Profile-Id`. `returnUrl` and the 3DS `origin` follow the
browser's same-host `Origin`
([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## Outputs

**Pages.**

| Page                                                          | What it renders                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                           | only the flow tiles, grouped as checkout and beyond checkout; width and type scale with the viewport up to a cap, centred between header and footer                                                              |
| `/sessions`, `/advanced`, `/api-only`, `/mit`, `/pay-by-link` | `routes/[flow].tsx` and `FlowWorkbench`; bootstrap is fetched in-process before first paint                                                                                                                      |
| `/back-office`                                                | orders in plain words, search and filters, detail with capture/cancel/refund and the reason an action is refused                                                                                                 |
| `/settings`                                                   | the Connection card (profile, merchant account, client key, webhook HMAC key set or not, webhook URL to copy) and the TEST profiles                                                                              |
| `/wiki`                                                       | in-app notes on each flow                                                                                                                                                                                        |
| `/result`                                                     | `RedirectReturn`: with a `redirectResult` it submits it, settles the order and shows the result; without one it polls the order (10 times, 3 s apart); `redirectResult` and `sessionId` are removed from the URL |
| `/disclaimer`                                                 | the TEST-only disclaimer                                                                                                                                                                                         |

`FlowWorkbench` is one row on top: the flow as a rounded badge (the page's `h1`) and a scenario chip
(flag, market, amount, integration) that opens the configuration sheet; then the checkout, with the
inspector beside it (under it on a phone). Switching flow goes through Home. It mounts Drop-in, a
single Component or the API-only Custom Card; Sessions, Advanced and API only start on load, and
every scenario or theme change restarts the checkout 500 ms later. A run counter stops a slow
superseded start from mounting a second checkout, and callbacks are reported under the current run's
correlation id (a ref, not render state). The result card replaces the checkout once a payment ends,
and test cards open in a sheet. Partial payments (a gift card, then a card): `onOrderUpdated` is
recorded and, with Components, shows a "Partial payment … paid · … left to pay" banner and mounts
the card for the rest (Drop-in shows its own); Advanced also implements `onBalanceCheck`,
`onOrderRequest`, `onOrderCancel` and `onPaymentMethodsRequest`, and sends each payment's share
(`components/partial.ts`: a gift card pays what its balance covers, the next method the rest). After
a refused, cancelled or failed payment the result card offers "Try again": it remounts on the same
AdyenCheckout instance, so the session (with its latest `sessionData`) and any gift card order
survive; "New payment" starts a new session, and so does a retry after the fifth refusal in a
session, a `14_0422`/`14_0423` answer, or once the session expired (the card says so). The inspector
is open from the start (owner, 2026-10-10), polls the timeline every 2.5 s ("Live") and follows new
events unless the reader scrolled up.

`BackOffice` shows metrics (Authorised, Captured, Refused, Not paid), search by reference or PSP
reference, state filters, orders nobody tried to pay hidden by default, 12 per page with "Show
more", refresh every 4 s. The detail holds `LifecyclePanel.tsx`: a warning when the account captures
the method manually, the ledger (authorised, captured, refunded, pending), capture and refund with
an editable amount where partial is allowed, a disabled "Waiting for the ... webhook" button while
one is awaited, why the other actions are refused, and every capture, cancel and refund with its
outcome, PSP reference and Idempotency-Key. `ProfileManager` is the Connection card, then add,
select and delete TEST profiles. `RedirectReturn` is the `/result` island.

**JSON responses.**

- `201`: `/sessions` `{correlationId, order, session}`; `/payments`
  `{correlationId, attemptId, result, resolution}`; `/payment-links`
  `{correlationId, order, paymentLink}`; `/partial-orders` `{correlationId, order, adyenOrder}`;
  `/mit` `{correlationId, result, resolution}`; `/api-only` proxies the `/payments` answer.
- `200`: `/payment-methods` `{correlationId, shopperConversionId, paymentMethodsResponse}`;
  `/payments/details` `{correlationId, result, resolution}`; `/redirect-result`
  `{correlationId, result, resolution}` or `{alreadySettled: true, result, resolution}`;
  `GET /payment-links/:orderId` `{paymentLink, resolution}`; `/gift-card-balance`
  `{correlationId, result}`; `/partial-orders/:id/cancel` `{correlationId, result}`; `/orders`
  `{orders}`; `/orders/:id`
  `{order, attempts, timeline, ledger, modifications, capabilities, permissions}`; `/config`
  `{countries, paymentMethodRules, capabilities}`; `/webhooks/:correlationId` `{waiting, entries}`.
- `202`: `/orders/:id/actions/:action` `{actionId, idempotencyKey, result}`; `/webhook`
  `[accepted]`.

`/sessions` creates the order and its session row; `/payments` creates an order unless `orderId`
names one, and always an attempt; `/payment-links`, `/partial-orders` and `/mit` create an order,
MIT also an attempt; `/orders` lists each order with its attempts and permissions.

`resolution` is the derived `{state, paidValue}` of the order; `session` is Adyen's session object,
and the order and its session row both expire after 25 minutes (`expiresAt`, owner, 2026-10-16).
`/payments/details` settles the attempt `/payments` left pending, and `/redirect-result` settles or
creates one. A redirect return for a Sessions order creates the attempt the session result would
have created; a reload with nothing waiting answers `alreadySettled` from the stored outcome instead
of resubmitting. A `GET /payment-links/:orderId` re-derives the order from the link status.
`/partial-orders` is Advanced's `onOrderRequest`: it creates the server order every payment of the
split goes into. `/partial-orders/:id/cancel` is Advanced's `onOrderCancel` (Drop-in's "Supprimer"
on a paid gift card).

**Refusals.** 400 for a bad amount or currency, an unsupported action, an amount outside the
permission, a partial amount on a method that takes only the full one, raw card data, a missing
`redirectResult`, a missing `order` pair, a missing MIT token or reference, and an API-only body
without Adyen-encrypted values or a token. 401 for a webhook item whose HMAC matches no profile (the
whole delivery is refused so Adyen retries). 403 for a CSRF failure or a cross-origin request. 404
for an unknown order, correlation id or payment link, and for an unknown flow page. 409 for a
duplicate action still in flight, no authorised payment, a refused permission (the reason is in
`error`), and a redirect that belongs to another order. 429 above 120 requests per minute. 500 is
`{error, correlationId}` and writes an audit row.

**Persisted rows.** `orders` (reference `digital-<epoch ms>-<id prefix>`), `payment_sessions`,
`attempts`, `payment_parts`, `api_calls`, `frontend_callbacks`, `webhooks` (deduplicated on
`pspReference:originalReference:eventCode:success`), `lifecycle_actions` (unique `idempotency_key`)
and `audit_log`. Each app keeps its 70 most recently updated orders; older ones are purged on the
next order creation ([data model](../architecture/data-model.md)).

**Shared pieces (`components/`).** `status.ts` gives plain-language labels: `payment_pending` reads
"Authorised, awaiting capture", or "Captured" when the method captures on authorisation (refund
already allowed); an authorised payment reads Authorised, Capture requested, Partially captured,
Captured, Refund requested, Partially refunded, Refunded or Cancelled from its ledger.
`Timeline.tsx` shows only what Adyen produced (Adyen Web callbacks, Checkout API calls, webhooks);
Back Office action rows and older playground rows are left out. Every `onChange` is its own row,
summarised by what moved since the previous one (`onChangeDiff.ts`); rows carry the time since the
first event, HTTP status, duration and result, with filters and counts, search over names and
payloads, Copy all, Export (JSON file) and Clear. The detail has Request/Response (API; Response
opens first), each in its own colour (request blue, response green, red on an error) with a header
naming the direction and HTTP status, Changes/Payload (`onChange`), coloured JSON with long values
folded, Copy JSON and Copy cURL (`curl.ts`, API key left to `$ADYEN_API_KEY`). `onChangeDiff.ts`,
`curl.ts` and `read.ts` are the pure parts, with tests. `Sheet.tsx`, `ResultCard.tsx`,
`TestData.tsx`, `FlowIcon.tsx` (one icon per flow, for the checkout badge) and `flows.ts` complete
the set. Markets are 36 countries with their own currency, locale and default amount
(`packages/platform/markets.ts`); installments are offered in BR, MX and JP.

## Invariants

1. **TEST only.** `packages/platform/test-only.ts` rejects any environment but `test`, a LIVE host
   and a `live_` client key; `packages/platform/adyen.test.ts` ("sessions uses the exact Checkout
   v72 TEST endpoint and TEST credentials") pins the endpoint and credentials.
2. **Secrets stay server-side.** `GET /api/bootstrap` returns profile metadata, the publishable
   `clientKey` only when it starts with `test_`, and never the API, HMAC or bearer secrets
   (`packages/platform/base-api.ts`); `packages/platform/sanitize.test.ts` proves credentials are
   redacted before persistence.
3. **An order's state comes from Adyen's answers and HMAC-valid webhooks, never from the browser.**
   `packages/platform/state-machine.test.ts` ("a successful CAPTURE webhook settles the order as
   paid", "a later webhook never reopens a settled order"); `api.ts` writes an order's state only
   through `settleAttempt` and `resolveAndStore`, and `/webhook`'s AUTHORISATION branch writes the
   attempt before the same derivation.
4. **A refusal ends an attempt, not an order.** `packages/platform/state-machine.test.ts` ("a
   refused attempt never closes a still-valid order"); the island's retry keeps the session and its
   gift card order (`islands/FlowWorkbench.tsx`).
5. **Request bodies are built per endpoint; `state.data` is never forwarded wholesale.**
   `apps/adyen-digital/api.ts` (`requestBase`, `FORWARDED_STATE_DATA`) and
   `packages/platform/adyen.ts`; `packages/platform/adyen.test.ts` pins the session endpoint, the
   balance endpoint and upstream error handling.
6. **Money is integer minor units.** `amountFrom` in `apps/adyen-digital/api.ts` accepts 1 to
   100000000; `packages/platform/markets.test.ts` ("zero-decimal currencies are never given
   fractional minor units") and `apps/adyen-digital/components/partial.test.ts` pin the rest.
7. **Only HMAC-valid webhook items are processed; one invalid item refuses the delivery.**
   `packages/platform/hmac.test.ts` ("standard webhook HMAC accepts the signed item and rejects
   mutation"); `apps/adyen-digital/api.ts` returns 401 and records the verdict.
8. **A capture, cancel or refund is idempotent per key, and a request awaiting its webhook blocks
   another of its kind.** `packages/platform/lifecycle.test.ts` ("a received capture blocks the next
   one until its webhook arrives"); `apps/adyen-digital/api.ts` returns 409 or the stored request.
9. **A partial payment never exceeds its order.** `apps/adyen-digital/api.ts` refuses it with 400;
   `apps/adyen-digital/components/partial.test.ts` ("a gift card pays what its balance covers,
   anything else pays the rest") and `packages/platform/state-machine.test.ts` ("partial tender
   remains open for the balance").
10. **Raw card data is refused; only Adyen-encrypted values or tokens pass.** `rejectRawCardData` in
    `packages/platform/sanitize.ts`, tested by `packages/platform/sanitize.test.ts` ("raw PAN and
    CVC are rejected while Adyen encrypted fields are accepted"); `/api-only` checks again before
    proxying.

## Determinism

`deterministic`. Every page, JSON body, stored row and order state is produced by code from the
request and the recorded Adyen answers; there is no model and no free text. The pure parts
(`resolveOrder`, `partial.ts`, `onChangeDiff.ts`, `curl.ts`, `read.ts`) are pinned by tests, and the
same recorded attempts and webhooks always derive the same state. Adyen's own answer and the moment
a webhook arrives are external input: a payment whose webhook never arrives stays `open` or
`payment_pending` until the event does.

## Acceptance checks

```bash
deno task check
deno task test
deno task --cwd apps/adyen-digital build
deno task ssr:assert
deno task knowledge:check
```

`deno task check` is the gate: `fmt:check`, `lint`, `knowledge:check`, `types`, `test` (all packages
and apps), the four app builds and `ssr:assert`. The digital build fails on a type or import error;
the SSR assertion (`tools/build/assert-built-ssr.ts apps/adyen-digital "Digital Checkout"`) fails
when the built page no longer contains the app's name. `deno task test` alone runs
`deno test -A --parallel packages apps tools/knowledge`.

Not automated: the browser paths. A person runs `deno task --cwd apps/adyen-digital dev` (:5173) or
`deno task dev:digital` (:8001) with TEST credentials and completes Sessions (Drop-in and
Components), Advanced with a 3DS challenge, a redirect method back through `/result`, a Back Office
capture/refund whose webhook arrives, Native 3DS off, a gift card partial payment, MIT, Pay by Link
and API only. Webhooks need a public URL locally
([runbook](../operations/webhooks-without-a-tunnel.md)); the evidence and level of each past run are
in [current/digital-status.md](../current/digital-status.md).

## Out of scope

- Production use, LIVE endpoints or real credentials: `packages/platform/test-only.ts` refuses them.
- PCI scope: raw PAN and CVC are refused; only Adyen-hosted encrypted fields and stored tokens are
  accepted.
- A certified or reference integration: the README disclaimer applies.
- Chargebacks and disputes: no workflow; the ledger covers capture, cancel and refund events only.
- `GET /sessions/{id}` polling: never called, because Adyen does not update the status it returns.
- User accounts, roles or per-user data: one shared profile set behind optional Basic Auth.

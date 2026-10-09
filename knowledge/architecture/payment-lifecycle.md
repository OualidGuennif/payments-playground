---
type: Architecture
title: "Payment lifecycle in adyen-digital: orders, attempts, and where each outcome comes from"
description: "The order/attempt model, how resolveOrder derives an order's state, which API response or webhook writes the outcome of each flow, how capture, cancel and refund are permitted, and how webhooks are correlated."
tags: [architecture, digital, state-machine, lifecycle, webhooks]
status: stable
scope: payment-lifecycle
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: state-machine
    resource: packages/platform/state-machine.ts
    title: mapAdyenResultCode and resolveOrder
  - id: lifecycle
    resource: packages/platform/lifecycle.ts
    title: Per-method capabilities, actionPermissions, lifecycleSourceAttempt
  - id: digital-api
    resource: apps/adyen-digital/api.ts
    title: settleAttempt, resolveAndStore, the session-result route, the webhook handler
verified:
  - at: 2026-10-09
    check: "Sessions Drop-in, Advanced 3DS2 challenge and a stored-card Advanced payment on Adyen TEST each ended authorised in the Back Office; a capture was accepted; a signed CAPTURE notification settled the order paid. Evidence in current/digital-status.md."
---

# Payment lifecycle in adyen-digital

## The model

- **Order**: one checkout. Created by `/sessions`, `/payments` (Advanced, API only), MIT, Pay by
  Link or `/orders`. Its `reference` is `digital-<epoch ms>-<id prefix>` and is what Adyen echoes
  back as `merchantReference`. Its id is the **correlation id** every log row hangs off.
- **Attempt**: one authorisation try on an order, with its PSP reference. States: `created`,
  `pending`, `authorised`, `refused`, `cancelled`, `expired`, `error`. `mapAdyenResultCode` maps
  `Authorised` to `authorised`; `Received`, `Pending`, `PresentToShopper`, `RedirectShopper`,
  `IdentifyShopper` and `ChallengeShopper` to `pending`; anything unknown to `created`.
- **Payment part**: one authorised PSP reference on an order. Idempotent per
  `(order, pspReference, state)`, because the `/payments` response and the AUTHORISATION webhook
  report the same authorisation.
- **A refusal ends an attempt, not an order.** The order stays open while its link or order is valid
  and another attempt could follow.

## How an order's state is derived

`resolveOrder` recomputes the state from the attempts plus at most one terminal event, in this order
of precedence:

1. `paid` and `cancelled` are **settled**: once reached they never change again
   ([ADR-007](../decisions/ADR-007-order-state-from-authoritative-events.md)).
2. `ORDER_CLOSED` (partial payments): `success=true` gives `paid`, `false` gives `cancelled`.
3. A successful `CAPTURE` webhook gives `paid`; a successful `CANCELLATION` gives `cancelled`. A
   failed one changes nothing.
4. A completed payment link with the full amount authorised gives `paid`.
5. Past the link's or order's effective expiry: `expired`.
6. Some but not all of the amount authorised: `partially_paid`.
7. Full amount authorised, or any attempt still pending: `payment_pending`. For a card that means
   "authorised, not yet captured".
8. Otherwise: `open`.

Authorised amounts are summed once per PSP reference.

## Where each flow's outcome is written

| Flow               | Outcome source                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions           | Adyen Web runs the payment. `onPaymentCompleted`/`onPaymentFailed` hand the island a `sessionResult`; it posts it to `POST /api/digital/sessions/:orderId/result`, which calls `GET /sessions/{id}?sessionResult=` and writes one attempt per returned payment. |
| Advanced           | `/payments` response through `settleAttempt`. If it returns an action (3DS, redirect), `onAdditionalDetails` posts to `/api/digital/payments/details`, whose response settles the attempt that was left pending.                                                |
| API only           | Same as Advanced, after an explicit raw-card-data check, by proxying to `/api/digital/payments`.                                                                                                                                                                |
| MIT                | `/payments` with `ContAuth`, through `settleAttempt`.                                                                                                                                                                                                           |
| Pay by Link        | `GET /api/digital/payment-links/:orderId` reads the link status; AUTHORISATION webhooks write the attempts.                                                                                                                                                     |
| Any, with webhooks | AUTHORISATION creates or updates the attempt by PSP reference. CAPTURE and CANCELLATION settle the order. ORDER_CLOSED closes partial orders. REFUND is recorded only.                                                                                          |

Webhooks only reach a public URL. Locally they need a tunnel or a replay
([runbook](../operations/webhooks-without-a-tunnel.md)); everything above except the webhook row
works without them.

## Webhook handling

- Every item is HMAC-checked against every profile's `hmacKey`, recorded (deduplicated on
  `pspReference:originalReference:eventCode:success`), and only processed when the HMAC is valid. An
  invalid item makes the whole delivery answer 401 so Adyen retries.
- Correlation, in order: `additionalData.paymentLinkId`, then `merchantReference` (an order
  reference), then `originalReference` and `pspReference` through the attempts table. The third step
  exists because a modification's `merchantReference` is the reference this server gave the
  modification (`capture-<order reference>`), not the order's.
- Processing is idempotent (attempt upserts, idempotent payment parts, a pure state derivation), so
  a redelivery changes nothing.

## Capture, cancel and refund

`actionPermissions(state, paymentMethod, authorisedValue)` decides, from the capabilities in
`packages/platform/lifecycle.ts` (editable without touching flow code):

- **Capture**: the order is `payment_pending` or `partially_paid` and the method supports separate
  capture and is not configured as captured on authorisation.
- **Cancel**: same states, the method supports cancel, nothing captured yet.
- **Refund**: the order is `paid`, or the method is captured on authorisation (PayPal on this
  account; iDEAL, MB WAY, Wero, WeChat Pay, Pay by Bank and gift cards by nature) and some amount is
  authorised.

Actions target the latest **authorised** attempt (`lifecycleSourceAttempt`), are idempotent on the
`Idempotency-Key` header, and are recorded as `received`. Their outcome arrives as a webhook.

Known gaps in this model are tracked in [current/digital-status.md](../current/digital-status.md).

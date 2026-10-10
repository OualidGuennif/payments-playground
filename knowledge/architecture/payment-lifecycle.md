---
type: Architecture
title: "Payment lifecycle in adyen-digital: orders, attempts, and where each outcome comes from"
description: "The order/attempt model, how resolveOrder derives an order's state, which API response or webhook writes the outcome of each flow, how capture, cancel and refund are permitted, and how webhooks are correlated."
tags: [architecture, digital, state-machine, lifecycle, webhooks]
status: stable
scope: payment-lifecycle
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T15:00:00Z
sources:
  - id: state-machine
    resource: packages/platform/state-machine.ts
    title: mapAdyenResultCode and resolveOrder
  - id: lifecycle
    resource: packages/platform/lifecycle.ts
    title: Per-method capabilities, actionPermissions, lifecycleSourceAttempt
  - id: modifications
    resource: packages/platform/modifications.ts
    title: reconcile and ledgerOf
  - id: digital-api
    resource: apps/adyen-digital/api.ts
    title: settleAttempt, resolveAndStore, the session-result route, the webhook handler
verified:
  - at: 2026-10-10
    check: "On Adyen TEST, order 2b5a2f81: partial capture 40.00 EUR, partial refund 10.00 EUR and a second partial capture 20.00 EUR all answered received; their real CAPTURE and REFUND webhooks (success=true, HMAC-signed, fetched from webhook.site) replayed locally settled the ledger to 60.00 captured and 10.00 refunded. A replayed Idempotency-Key returned the stored request without a second Adyen call; a new key while a capture was pending got 409."
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

Every capture, cancel and refund is a **modification**. What they add up to is a **ledger**
(`packages/platform/modifications.ts`), and what can be done next comes from it
(`actionPermissions(state, paymentMethod, ledger)` in `lifecycle.ts`).

- **Requests** are the `lifecycle_actions` rows this server writes: `requested` before the call,
  `received` with the modification's own PSP reference once Adyen answers, `rejected` if the call
  fails.
- **Events** are the HMAC-valid CAPTURE, CAPTURE_FAILED, CANCELLATION, REFUND, REFUND_FAILED and
  REFUNDED_REVERSED webhooks of the order. `reconcile()` matches each request to its events by that
  PSP reference (older rows without one take the next event of their kind); the latest event wins,
  so a CAPTURE_FAILED days later overturns a success. Events nothing here asked for (the Customer
  Area) become modifications of their own.
- **Ledger**: authorised (the source attempt), captured, refunded, and what is pending a webhook. A
  method captured on authorisation counts its authorised amount as captured.

Permissions, from the ledger and the method's capabilities:

- **Capture** up to what is authorised and not captured; in part when the method allows it; again
  after a first partial capture only when the method supports multiple partial captures (the
  merchant account must have them enabled too: OGAccountECOM does, verified 2026-10-10).
- **Cancel** while nothing is captured or being captured.
- **Refund** up to what is captured and not refunded; in part, and repeatedly, per method.
- A request Adyen answered `received` blocks another of its kind until its webhook arrives (the
  button reads "Waiting for the CAPTURE webhook"). The webhook is the outcome; the response is only
  an acknowledgement.

**Idempotency.** The Back Office mints one `Idempotency-Key` (UUID v4) per intent (order, action,
amount) and reuses it when a request got no answer. The server forwards it to Adyen, which keeps it
7 to 14 days and answers a repeat with the first response (HTTP 409 or 422 with code 704 while the
first is in flight), and stores it: a key it has seen returns the stored request without calling
Adyen.

Actions target the latest **authorised** attempt (`lifecycleSourceAttempt`). Capabilities per
method, and how this account captures each:
[capture and refund capabilities](../references/capture-and-refund-capabilities.md).

---
type: Current State
title: "adyen-digital: what is verified, and what is still open"
description: "Evidence-backed state of the digital playground as of 2026-10-09: each flow with the verification level it reached, and the open gaps in priority order."
tags: [current, digital, verification]
status: stable
scope: digital-status
stale_after: 2026-11-09
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: api
    resource: apps/adyen-digital/api.ts
    title: Server behaviour verified below
  - id: workbench
    resource: apps/adyen-digital/islands/FlowWorkbench.tsx
    title: Client behaviour verified below
  - id: policy
    resource: knowledge/policies/verification-and-reporting.md
    title: Meaning of the levels
verified:
  - at: 2026-10-09
    check: "Every PASS row below, on Adyen TEST, from the dev server at localhost:5173 unless stated."
---

# adyen-digital: what is verified, and what is still open

As of 2026-10-09, Adyen Web 6.46.0, Checkout API v72. Re-verify before 2026-11-09 or mark STALE.

## Verified

| What                                                                                | Status  | Level                             | Evidence                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop-in loads with an ad blocker (Firefox, dev server)                              | PASS    | BROWSER VERIFIED                  | Headless Firefox 157 with an `analytics` request block: Drop-in ready, 13 methods. Before the fix: placeholder only, the user's HAR showed `core/Analytics/*.js` blocked. |
| Sessions Drop-in, stored card                                                       | PASS    | BROWSER VERIFIED                  | Order `d13195db`: `GET /sessions/{id}` 200, attempt authorised `HC9HHTMGTVL4C5V5`, order `payment_pending`, 10 999 paid                                                   |
| Advanced Drop-in, 3DS2 challenge                                                    | PASS    | BROWSER VERIFIED                  | Order `ee0fbff7`: `/payments` IdentifyShopper with `returnUrl` on `localhost:5173`, `/payments/details` Authorised, attempt `TZVGV9DFXNTZJMV5` authorised                 |
| Advanced Drop-in, stored card, `riskData` forwarded                                 | PASS    | TEST API VERIFIED                 | `/payments` request carries `riskData.clientData`; Authorised                                                                                                             |
| Capture from the Back Office API                                                    | PASS    | TEST API VERIFIED                 | `202`, `status: received`, modification `S72X6VJX9H7VJT65` on `TZVGV9DFXNTZJMV5`                                                                                          |
| CAPTURE notification settles the order                                              | PARTIAL | WEBHOOK VERIFIED (simulated)      | Signed with the local key: 202, order `ee0fbff7` `paid`. Adyen's real CAPTURE (seen on webhook.site) has the same shape but is signed with another endpoint's key.        |
| Callbacks reported under the right order                                            | PASS    | BROWSER VERIFIED                  | `frontend_callbacks` rows for `d13195db`: onChange ×5, beforeSubmit, onPaymentCompleted                                                                                   |
| Docker image: no secrets inside, runs with a quoted `.env`, Basic Auth covers pages | PASS    | CODE VERIFIED + TEST API VERIFIED | 14 payment methods listed from inside the container; pages 401/200 without/with credentials                                                                               |

## Not observed

`NOT_OBSERVED`: Pay by Link, MIT, API only (Custom Card), the Components integration, partial
payments, a refund, any redirect method round trip (PayPal, Wero, Alma...), and everything on the
Render deployment after these changes.

`OWNER_ACTION_REQUIRED`: confirm Drop-in in your own Firefox with Adblock Plus enabled.

## Open gaps, most important first

1. **Lifecycle actions stay `received`.** Neither the modification response nor its webhook updates
   the `lifecycle_actions` row; the timeline shows the webhook, the action row does not.
2. **The card capture model assumes manual capture.** `scheme` is modelled as separate capture. On a
   merchant account that captures automatically, capture is still offered and refund only unlocks
   after a CAPTURE webhook. Not verified against such an account.
3. **REFUND is recorded, not modelled.** There is no `refunded` state; a refunded order stays
   `paid`.
4. **Webhook dedupe ignores the HMAC verdict.** If a delivery with a bad signature is recorded
   first, the row for a later valid delivery is not stored (it is still processed).
5. **`/api/digital/payment-methods` trusts a client-sent `correlationId`.**
6. **API only's "encrypted value" check is a heuristic** (any string longer than 12 characters
   passes); `rejectRawCardData` is the real guard.
7. **Styling and agentic do not use the dev bundle plugin**, so their dev servers still break under
   an ad blocker.
8. **`/api/digital/partial-orders` has no client flow.**

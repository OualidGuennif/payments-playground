---
type: Current State
title: "adyen-digital: what is verified, and what is still open"
description: "Evidence-backed state of the digital playground as of 2026-10-10: each flow with the verification level it reached, and the open gaps in priority order."
tags: [current, digital, verification]
status: stable
scope: digital-status
stale_after: 2026-11-10
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T06:45:00Z
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
  - at: 2026-10-10
    check: "Rows dated 2026-10-10: redirect return, Pay by Link, MIT, API only, Components in dark mode, headless Firefox with an analytics block on digital and styling."
---

# adyen-digital: what is verified, and what is still open

As of 2026-10-10, Adyen Web 6.46.0, Checkout API v72. Re-verify before 2026-11-10 or mark STALE.

## Verified

| What                                                                                | Status | Level                             | Evidence                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drop-in loads with an ad blocker (Firefox, dev server)                              | PASS   | BROWSER VERIFIED                  | Headless Firefox 157 with an `analytics` request block: Drop-in ready, 13 methods. Before the fix: placeholder only, the user's HAR showed `core/Analytics/*.js` blocked.                                                                                                |
| Sessions Drop-in, stored card                                                       | PASS   | BROWSER VERIFIED                  | Order `d13195db`: `GET /sessions/{id}` 200, attempt authorised `HC9HHTMGTVL4C5V5`, order `payment_pending`, 10 999 paid                                                                                                                                                  |
| Advanced Drop-in, 3DS2 challenge                                                    | PASS   | BROWSER VERIFIED                  | Order `ee0fbff7`: `/payments` IdentifyShopper with `returnUrl` on `localhost:5173`, `/payments/details` Authorised, attempt `TZVGV9DFXNTZJMV5` authorised                                                                                                                |
| Advanced Drop-in, stored card, `riskData` forwarded                                 | PASS   | TEST API VERIFIED                 | `/payments` request carries `riskData.clientData`; Authorised                                                                                                                                                                                                            |
| Capture from the Back Office API                                                    | PASS   | TEST API VERIFIED                 | `202`, `status: received`, modification `S72X6VJX9H7VJT65` on `TZVGV9DFXNTZJMV5`                                                                                                                                                                                         |
| CAPTURE notification settles the order                                              | PASS   | WEBHOOK VERIFIED                  | Adyen's own CAPTURE `ZC55WDCR763KPPT5` (delivered to webhook.site, HMAC-signed with that endpoint's key), replayed unchanged to a dev server holding that key: `hmac_valid = 1`, correlated by `originalReference`, order `5aa671e7` `payment_pending` to `paid`.        |
| Callbacks reported under the right order                                            | PASS   | BROWSER VERIFIED                  | `frontend_callbacks` rows for `d13195db`: onChange ×5, beforeSubmit, onPaymentCompleted                                                                                                                                                                                  |
| Docker image: no secrets inside, runs with a quoted `.env`, Basic Auth covers pages | PASS   | CODE VERIFIED + TEST API VERIFIED | 14 payment methods listed from inside the container; pages 401/200 without/with credentials                                                                                                                                                                              |
| Production after the 2026-10-09 deploy                                              | PASS   | DEPLOYED VERIFIED                 | `/api/health` reports Adyen Web 6.46.0 on digital and styling; Advanced and Sessions Drop-in ready (13 methods) in headless Firefox with an `analytics` block on `digital.payments-playground.com`.                                                                      |
| iDEAL redirect round trip through `/result` (2026-10-10)                            | PASS   | BROWSER VERIFIED                  | Order `8c1dd533`: `/payments` RedirectShopper, iDEAL test bank TESTNL2A "Success", back on `/result`: `/payments/details` Authorised `FD7JH26QRZQJH275`, `merchantReference` matches, attempt authorised. Reload with a replayed `redirectResult`: no second Adyen call. |
| Pay by Link, MIT, API only (2026-10-10)                                             | PASS   | BROWSER VERIFIED                  | Link created and refreshed (ACTIVE); MIT on the stored Amex Authorised; API only Custom Card with 4111 1111 1111 1111 Authorised                                                                                                                                         |
| Components integration in dark mode (2026-10-10)                                    | PASS   | BROWSER VERIFIED                  | Card component renders on dark tokens once Click to Pay's fixed white panel is overridden                                                                                                                                                                                |
| Ad blocker, digital and styling after the redesign (2026-10-10)                     | PASS   | BROWSER VERIFIED                  | Headless Firefox, `analytics` blocked: digital Advanced Drop-in ready (13 methods); styling Drop-in ready (13) in light and dark, preview background and ink identical in both themes                                                                                    |

## Not observed

`NOT_OBSERVED`: Pay by Link paid by a shopper, partial payments, a refund, a redirect method other
than iDEAL, a capture clicked in the redesigned Back Office, and everything on the Render deployment
after these changes.

`OWNER_ACTION_REQUIRED`: confirm Drop-in in your own Firefox with Adblock Plus enabled.

## Open gaps, most important first

1. **Lifecycle actions stay `received`.** Neither the modification response nor its webhook updates
   the `lifecycle_actions` row; the timeline shows the webhook, the action row does not.
2. **Capture capabilities cover this account's methods only.** Cards are captured manually and
   PayPal on authorisation (owner, 2026-10-09); every method the TEST account returns for FR now has
   an entry read from its Adyen docs page. A method outside that list falls back to the card
   profile. Gift cards keep their earlier entry (Adyen's page gave no feature table).
3. **REFUND is recorded, not modelled.** There is no `refunded` state; a refunded order stays
   `paid`.
4. **Webhook dedupe ignores the HMAC verdict.** If a delivery with a bad signature is recorded
   first, the row for a later valid delivery is not stored (it is still processed).
5. **`/api/digital/payment-methods` trusts a client-sent `correlationId`.**
6. **API only's "encrypted value" check is a heuristic** (any string longer than 12 characters
   passes); `rejectRawCardData` is the real guard.
7. **Agentic does not use the dev bundle plugin** (styling does since 2026-10-09), so its dev server
   still breaks under an ad blocker. Out of scope by owner decision.
8. **`/api/digital/partial-orders` has no client flow.**

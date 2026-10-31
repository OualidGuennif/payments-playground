---
type: Current State
title: "adyen-digital: what is verified, and what is still open"
description: "Evidence-backed state of the digital playground as of 2026-10-15: each flow with the verification level it reached, and the open gaps in priority order."
tags: [current, digital, verification]
status: stable
scope: digital-status
stale_after: 2026-11-10
generated:
  by: claude-code/opus-5.5
  at: 2026-10-16T18:20:00Z
sources:
  - id: api
    resource: ../../apps/adyen-digital/api.ts
    title: Server behaviour verified below
  - id: workbench
    resource: ../../apps/adyen-digital/islands/FlowWorkbench.tsx
    title: Client behaviour verified below
  - id: policy
    resource: ../policies/verification-and-reporting.md
    title: Meaning of the levels
verified:
  - at: 2026-10-16
    check: "Adyen Web 6.47.0: gift card partial (Givex 50.00 + card 59.99) in Sessions Components/Drop-in and Advanced Components; native 3DS switch on Sessions and Advanced; Advanced Drop-in order cancelled through /orders/cancel."
  - at: 2026-10-13
    check: "Advanced Drop-in on localhost:5173: /payments carries shopperIP and a deliveryAddress without names; Authorised on Adyen TEST."
  - at: 2026-10-09
    check: "Rows dated 2026-10-09/10: redirect return, Pay by Link, MIT, API only, Components in dark mode, headless Firefox with analytics blocked on digital and styling."
---

# adyen-digital: what is verified, and what is still open

As of 2026-10-16, Adyen Web 6.47.0, Checkout API v72. Re-verify before 2026-11-10 or mark STALE.

## Verified

| What                                                                                | Status | Level                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop-in loads with an ad blocker (Firefox, dev server)                              | PASS   | BROWSER VERIFIED                  | Headless Firefox 157 with an `analytics` request block: Drop-in ready, 13 methods. Before the fix: placeholder only, the user's HAR showed `core/Analytics/*.js` blocked.                                                                                                                                                                                                                                                                                 |
| Sessions Drop-in, stored card                                                       | PASS   | BROWSER VERIFIED                  | Order `d13195db` (2026-10-09, through `GET /sessions/{id}`, removed 2026-10-15): attempt authorised `HC9HHTMGTVL4C5V5`. Since then a Sessions order is settled by its AUTHORISATION webhook only                                                                                                                                                                                                                                                          |
| Advanced Drop-in, 3DS2 challenge                                                    | PASS   | BROWSER VERIFIED                  | Order `ee0fbff7`: `/payments` IdentifyShopper with `returnUrl` on `localhost:5173`, `/payments/details` Authorised, attempt `TZVGV9DFXNTZJMV5` authorised                                                                                                                                                                                                                                                                                                 |
| Advanced Drop-in, stored card, `riskData` forwarded                                 | PASS   | TEST API VERIFIED                 | `/payments` request carries `riskData.clientData`; Authorised                                                                                                                                                                                                                                                                                                                                                                                             |
| Capture from the Back Office API                                                    | PASS   | TEST API VERIFIED                 | `202`, `status: received`, modification `S72X6VJX9H7VJT65` on `TZVGV9DFXNTZJMV5`                                                                                                                                                                                                                                                                                                                                                                          |
| CAPTURE notification settles the order                                              | PASS   | WEBHOOK VERIFIED                  | Adyen's own CAPTURE `ZC55WDCR763KPPT5` (delivered to webhook.site, HMAC-signed with that endpoint's key), replayed unchanged to a dev server holding that key: `hmac_valid = 1`, correlated by `originalReference`, order `5aa671e7` `payment_pending` to `paid`.                                                                                                                                                                                         |
| Callbacks reported under the right order                                            | PASS   | BROWSER VERIFIED                  | `frontend_callbacks` rows for `d13195db`: onChange ×5, beforeSubmit, onPaymentCompleted                                                                                                                                                                                                                                                                                                                                                                   |
| Docker image: no secrets inside, runs with a quoted `.env`, Basic Auth covers pages | PASS   | CODE VERIFIED + TEST API VERIFIED | 14 payment methods listed from inside the container; pages 401/200 without/with credentials                                                                                                                                                                                                                                                                                                                                                               |
| Production after the 2026-10-09 deploy                                              | PASS   | DEPLOYED VERIFIED                 | `/api/health` reports Adyen Web 6.46.0 on digital and styling; Advanced and Sessions Drop-in ready (13 methods) in headless Firefox with an `analytics` block on `digital.payments-playground.com`.                                                                                                                                                                                                                                                       |
| iDEAL redirect round trip through `/result` (2026-10-10)                            | PASS   | BROWSER VERIFIED                  | Order `8c1dd533`: `/payments` RedirectShopper, iDEAL test bank TESTNL2A "Success", back on `/result`: `/payments/details` Authorised `FD7JH26QRZQJH275`, `merchantReference` matches, attempt authorised. Reload with a replayed `redirectResult`: no second Adyen call.                                                                                                                                                                                  |
| Pay by Link, MIT, API only (2026-10-10)                                             | PASS   | BROWSER VERIFIED                  | Link created and refreshed (ACTIVE); MIT on the stored Amex Authorised; API only Custom Card with 4111 1111 1111 1111 Authorised                                                                                                                                                                                                                                                                                                                          |
| Components integration in dark mode (2026-10-10)                                    | PASS   | BROWSER VERIFIED                  | Card component renders on dark tokens once Click to Pay's fixed white panel is overridden                                                                                                                                                                                                                                                                                                                                                                 |
| Ad blocker, digital and styling after the redesign (2026-10-10)                     | PASS   | BROWSER VERIFIED                  | Headless Firefox, `analytics` blocked: digital Advanced Drop-in ready (13 methods); styling Drop-in ready (13) in light and dark, preview background and ink identical in both themes                                                                                                                                                                                                                                                                     |
| Partial and multiple partial capture, partial refund (2026-10-10)                   | PASS   | WEBHOOK VERIFIED                  | Order `2b5a2f81`: capture 40.00, refund 10.00, capture 20.00, each `received`; their real CAPTURE/REFUND webhooks (HMAC-signed, from webhook.site) replayed locally: ledger 60.00 captured, 10.00 refunded. Same Idempotency-Key replayed: no second Adyen call; new key while pending: 409.                                                                                                                                                              |
| 3DS redirect with Native 3DS off, Sessions and Advanced (2026-10-15)                | PASS   | BROWSER VERIFIED                  | Card `4917 6100 0000 0000`. Advanced order `882b4d52`: `/payments` `nativeThreeDS: disabled`, RedirectShopper, simulator, `/payments/details` Authorised `R85BC24NTVL4C5V5`. Sessions order `f912134a`: `/sessions` `disabled`, simulator, `/payments/details` Authorised `N8P8W24NTVL4C5V5`. Switch on: `/payments` `preferred`, `threeDS2` action (order `fc1049cf`, challenge not completed).                                                          |
| Gift card partial payment, Sessions (2026-10-16, Adyen Web 6.47.0)                  | PASS   | BROWSER VERIFIED                  | Givex 50.00 then card 59.99 on 109.99. Components (order `8656939a`): `beforeSubmit` > `onOrderUpdated` > banner "50,00 € paid · 59,99 € left to pay", card mounted on its own > `onPaymentCompleted`. Drop-in: gift card deducted, stored Visa pays 59.99, Authorised. Order state still waits for webhooks locally.                                                                                                                                     |
| Gift card partial payment, Advanced (2026-10-16)                                    | PASS   | BROWSER VERIFIED                  | Components, order `6dded2b5`: `/paymentMethods/balance` NotEnoughBalance 5000 > `/orders` > `/payments` giftcard 5000 with `order` Authorised (5999 left) > `/paymentMethods` with `order` > `/payments` scheme 5999 Authorised (0 left); order `payment_pending`. Drop-in, order `bd311783`: « Supprimer » on the paid gift card > `onOrderCancel` > `/orders/cancel` Received, Drop-in back to 109.99. Before the fix: `Refused`, "Not enough balance". |
| Retry after a refusal keeps the session and the gift card order (2026-10-16)        | PASS   | BROWSER VERIFIED                  | Sessions Drop-in, order `8eb7bb62`: one `/sessions` (`expiresAt` 25 min), Givex 50.00 > `onOrderUpdated` > card `DECLINED` > `onPaymentFailed` > result "59,99 € left to pay" > Try again: Drop-in still lists the paid gift card > stored Visa > `onPaymentCompleted`, no second session. Advanced Drop-in: refused card, Try again remounts with no new Adyen call.                                                                                     |
| Five refusals close a session; Try again then opens a new one (2026-10-16)          | PASS   | BROWSER VERIFIED                  | Sessions Components. Before the fix: 5 × `DECLINED` = `200 Refused`, then a valid card = HTTP 422 `14_0422` (onError + onPaymentFailed) and Try again would have reused the dead session. After: 5 × `Refused`, the card says a new session opens, Try again creates `CSB297991D5FA78EE5BFF627E`, valid card `Authorised`. A lone `14_0422`/`14_0423` after the fix is handled in code, not re-observed.                                                  |
| Advanced Drop-in, `shopperIP` sent, `deliveryAddress` without names (2026-10-13)    | PASS   | BROWSER VERIFIED                  | Order `fddfac4a`, stored Visa: `/payments` request has `shopperIP: 127.0.0.1` (dev server, from the socket) and `deliveryAddress` with postal fields only; Authorised `TN9S74RKTVL4C5V5`. On Render the IP comes from `X-Forwarded-For`, not yet observed.                                                                                                                                                                                                |

## Not observed

`NOT_OBSERVED`: Pay by Link paid by a shopper, partial payments, a refund, a redirect method other
than iDEAL, a capture clicked in the redesigned Back Office, and everything on the Render deployment
after these changes.

`OWNER_ACTION_REQUIRED`: confirm Drop-in in your own Firefox with Adblock Plus enabled.

## Open gaps, most important first

1. **Capabilities are only as fresh as their last review.** `PAYMENT_METHOD_CAPABILITIES` follows
   Adyen's table (checked 2026-10-10); a method outside it falls back to the card profile, and the
   table must be re-checked every three months (a test fails after 92 days).
2. **Webhook dedupe ignores the HMAC verdict.** If a delivery with a bad signature is recorded
   first, the row for a later valid delivery is not stored (it is still processed).
3. **`/api/digital/payment-methods` trusts a client-sent `correlationId`.**
4. **API only's "encrypted value" check is a heuristic** (any string longer than 12 characters
   passes); `rejectRawCardData` is the real guard.
5. **Agentic does not use the dev bundle plugin** (styling does since 2026-10-09), so its dev server
   still breaks under an ad blocker. Out of scope by owner decision.
6. **`/api/digital/partial-orders` has no client flow.**

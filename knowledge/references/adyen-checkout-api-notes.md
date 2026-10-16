---
type: Reference
title: "Checkout API v72: what each endpoint accepts, and other facts this repo relies on"
description: "Per-endpoint field acceptance learned from rejections, why GET /sessions is not polled, modification references in webhooks, the Node library's query-string quirk, and the fields that tie a checkout together."
tags: [reference, adyen, checkout-api]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-16T14:30:00Z
sources:
  - id: api
    resource: apps/adyen-digital/api.ts
    title: Request bodies and the comments recording each rejection
  - id: typings
    resource: https://www.npmjs.com/package/@adyen/api-library/v/32.0.0
    title: "@adyen/api-library 32: lib/src/typings/checkout/*.d.ts are the field lists"
  - id: docs
    resource: https://docs.adyen.com/api-explorer/Checkout/72/overview
    title: Checkout API v72 reference
---

# Checkout API v72 notes

Adyen's documentation and the Customer Area are authoritative. These are the facts this repository
depends on; most were learned from a rejected request.

## Unknown fields are rejected, and the endpoints disagree

`/sessions`, `/payments` and `/paymentLinks` answer "contains the following unknown fields" to
anything outside their schema. The field lists in `@adyen/api-library`'s typings (`PaymentRequest`,
`CreateCheckoutSessionRequest`, `PaymentLinkRequest`) are the quickest check.

| Field                                                                                               | `/sessions` | `/payments`  | `/paymentLinks` | Notes                                                         |
| --------------------------------------------------------------------------------------------------- | ----------- | ------------ | --------------- | ------------------------------------------------------------- |
| `channel: "Web"`                                                                                    | required    | required     | rejected        | `/payments` fails without it, MIT included                    |
| `merchantRiskIndicator`                                                                             | rejected    | accepted     | rejected        |                                                               |
| `deliveryAddress.firstName/lastName`                                                                | accepted    | accepted     | rejected        | Sent on `/sessions` only; owner's choice for `/payments`      |
| `shopperConversionId`                                                                               | rejected    | accepted     | rejected        | Also on `/paymentMethods`; repeat the same id on `/payments`  |
| `shopperIP`                                                                                         | in typings  | accepted     | not in typings  | Sent on `/payments` only, from the connection, never the body |
| `storePaymentMethodMode`                                                                            | accepted    | n/a          | n/a             | Advanced uses `enableStoreDetails` + `storePaymentMethod`     |
| `lineItems`                                                                                         | accepted    | accepted     | accepted        | Without them BNPL methods (Klarna...) are excluded            |
| `riskData`, `installments`, `socialSecurityNumber`, `shopperName`, `telephoneNumber`, `dateOfBirth` |             | accepted     |                 | From Adyen Web `state.data`; forward them                     |
| `clientStateDataIndicator`                                                                          |             | **rejected** |                 | Not in `PaymentRequest` 32; never forward it                  |
| `checkoutAttemptId` as a sibling field                                                              |             | duplicate    |                 | Already inside `sdkData`; stripped from `paymentMethod`       |

## Sessions results

Adyen Web's `onPaymentCompleted` and `onPaymentFailed` receive a `sessionResult` in the Sessions
flow. `GET /sessions/{id}?sessionResult=<it>` exists, but Adyen's reference for it (as quoted by the
owner on 2026-10-15) says the status in its response is not updated and the request must not be made
again to follow the payment: use webhooks or the Customer Area's Transactions list. This playground
does not call it (owner, 2026-10-15); the AUTHORISATION webhook writes a Sessions attempt.

## The Node library drops query strings

`HttpURLConnectionClient.createRequest` builds the path from `url.pathname` only. A query string in
the endpoint disappears silently; pass `requestOptions.params` instead (`adyen.ts` supports it; no
call uses it today).

## Modifications and their webhooks

`POST /payments/{pspReference}/captures|cancels|refunds` answer `status: received` with a new PSP
reference. The outcome arrives as a CAPTURE, CANCELLATION or REFUND notification whose
`pspReference` is the modification's, `originalReference` the payment's, and `merchantReference` the
`reference` sent with the modification (here `capture-<order reference>`). Correlate on
`originalReference`.

## Gift cards and orders (partial payments)

Seen on TEST on 2026-10-16 with the Givex card `6036 2800 0000 0000 000`, PIN `122222` (balance
50.00 EUR) on a 109.99 EUR order:

- A gift card sent to `/payments` for more than its balance is `Refused`, "Not enough balance"
  (refusal code 12). Nothing splits it automatically.
- `/paymentMethods/balance` answers `NotEnoughBalance` with `balance` (5000) for this card.
- `/orders` (`amount`, `reference`, `merchantAccount`) answers `Success` with `orderData`,
  `pspReference` and `remainingAmount`. Each `/payments` into it carries `order` (`orderData`,
  `pspReference`) and its own `amount`: 5000 for the gift card, then 5999 for the card. Each answer
  carries `order.remainingAmount` (5999, then 0).
- `/paymentMethods` accepts the same `order`; `/orders/cancel` (`merchantAccount`, `order`) answers
  `Received`, the outcome comes as ORDER_CLOSED `success=false`.
- In the Sessions flow Adyen Web calls `sessions/{id}/paymentMethodBalance`, `sessions/{id}/orders`
  and `sessions/{id}/payments` itself; the merchant's server is not involved.

## Redirects and 3DS

`returnUrl` must be an origin the shopper's browser can reach. The `origin` field on `/payments` is
the page's origin, used by the native 3DS2 flow. Both follow the request's own origin here
([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

`authenticationData.threeDSRequestData.nativeThreeDS` (`preferred` or `disabled`, accepted by
`/sessions` and `/payments`) picks the 3DS2 experience. With the challenge card
`4917 6100 0000
0000`: `preferred` answers `IdentifyShopper` with a `threeDS2` action rendered
inside the checkout; `disabled` answers `RedirectShopper` with a `redirect` action to Adyen's
full-page simulator, and the return to `/result` settles through `/payments/details`. Seen for both
flows on 2026-10-15.

## Idempotency

Every mutating call sends an `Idempotency-Key`. Lifecycle actions take it from the client's
`Idempotency-Key` header so a double click cannot capture twice.

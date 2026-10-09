---
type: Reference
title: "Checkout API v72: what each endpoint accepts, and other facts this repo relies on"
description: "Per-endpoint field acceptance learned from rejections, session results, modification references in webhooks, the Node library's query-string quirk, and the fields that tie a checkout together."
tags: [reference, adyen, checkout-api]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
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

| Field                                                                                               | `/sessions` | `/payments`  | `/paymentLinks` | Notes                                                        |
| --------------------------------------------------------------------------------------------------- | ----------- | ------------ | --------------- | ------------------------------------------------------------ |
| `channel: "Web"`                                                                                    | required    | required     | rejected        | `/payments` fails without it, MIT included                   |
| `merchantRiskIndicator`                                                                             | rejected    | accepted     | rejected        |                                                              |
| `deliveryAddress.firstName/lastName`                                                                | accepted    | accepted     | rejected        | Payment links take a plain postal address                    |
| `shopperConversionId`                                                                               | rejected    | accepted     | rejected        | Also on `/paymentMethods`; repeat the same id on `/payments` |
| `storePaymentMethodMode`                                                                            | accepted    | n/a          | n/a             | Advanced uses `enableStoreDetails` + `storePaymentMethod`    |
| `lineItems`                                                                                         | accepted    | accepted     | accepted        | Without them BNPL methods (Klarna...) are excluded           |
| `riskData`, `installments`, `socialSecurityNumber`, `shopperName`, `telephoneNumber`, `dateOfBirth` |             | accepted     |                 | From Adyen Web `state.data`; forward them                    |
| `clientStateDataIndicator`                                                                          |             | **rejected** |                 | Not in `PaymentRequest` 32; never forward it                 |
| `checkoutAttemptId` as a sibling field                                                              |             | duplicate    |                 | Already inside `sdkData`; stripped from `paymentMethod`      |

## Sessions results

Adyen Web's `onPaymentCompleted` and `onPaymentFailed` receive a `sessionResult` in the Sessions
flow. `GET /sessions/{id}?sessionResult=<it>` returns `status` (`active`, `canceled`, `completed`,
`expired`, `paymentPending`, `refused`) and `payments[]` with `pspReference`, `resultCode`, `amount`
and `paymentMethod.type`.

## The Node library drops query strings

`HttpURLConnectionClient.createRequest` builds the path from `url.pathname` only. A query string in
the endpoint disappears silently; pass `requestOptions.params` instead (`adyen.ts` does).

## Modifications and their webhooks

`POST /payments/{pspReference}/captures|cancels|refunds` answer `status: received` with a new PSP
reference. The outcome arrives as a CAPTURE, CANCELLATION or REFUND notification whose
`pspReference` is the modification's, `originalReference` the payment's, and `merchantReference` the
`reference` sent with the modification (here `capture-<order reference>`). Correlate on
`originalReference`.

## Redirects and 3DS

`returnUrl` must be an origin the shopper's browser can reach. The `origin` field on `/payments` is
the page's origin, used by the native 3DS2 flow. Both follow the request's own origin here
([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## Idempotency

Every mutating call sends an `Idempotency-Key`. Lifecycle actions take it from the client's
`Idempotency-Key` header so a double click cannot capture twice.

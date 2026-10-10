---
type: Reference
title: "Capture and refund capabilities per payment method, and how this account captures"
description: "Separate, partial and multiple partial captures and refunds per payment method from Adyen's docs, OGAccountECOM's capture setup (manual for cards, immediate for PayPal), how to change it, and idempotency rules for modifications."
tags: [reference, capture, refund, idempotency, payment-methods]
status: stable
stale_after: 2027-01-10
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T15:00:00Z
sources:
  - id: adyen-payment-methods
    resource: https://docs.adyen.com/payment-methods
    title: Adyen's payment method feature table (read 2026-10-10)
  - id: adyen-capture
    resource: https://docs.adyen.com/online-payments/capture
    title: Capture, partial and multiple partial captures
  - id: adyen-refund
    resource: https://docs.adyen.com/online-payments/refund
    title: Refunds, partial and multiple partial refunds
  - id: adyen-idempotency
    resource: https://docs.adyen.com/development-resources/api-idempotency
    title: API idempotency
  - id: table
    resource: packages/platform/lifecycle.ts
    title: PAYMENT_METHOD_CAPABILITIES, CAPABILITIES_REVIEWED_ON
---

# Capture and refund capabilities

Two separate questions, and integrations go wrong when they are confused:

1. **What Adyen supports for the method.** Fixed by Adyen, per method.
2. **How the merchant account captures it.** A setting: immediate, delayed, or manual.

## What Adyen supports (checked 2026-10-10)

| Method                                  | Separate capture | Partial capture | Multiple partial captures | Partial refund | Multiple partial refunds |
| --------------------------------------- | :--------------: | :-------------: | :-----------------------: | :------------: | :----------------------: |
| Cards (Visa, Mastercard, Amex, CB, ...) |        ✓         |        ✓        |             ✓             |       ✓        |            ✓             |
| Apple Pay, Google Pay                   |        ✓         |        ✓        |             ✓             |       ✓        |            ✓             |
| PayPal                                  |        ✓         |        ✓        |             ✓             |       ✓        |            ✓             |
| Klarna (Pay later, over time, now)      |        ✓         |        ✓        |             ✓             |       ✓        |            ✓             |
| SEPA Direct Debit                       |        ✓         |        ✓        |             ✓             |       ✓        |            ✓             |
| Alma, Oney 3x/4x                        |        ✓         |        ✓        |             ✗             |       ✓        |            ✓             |
| ANCV                                    |        ✓         |        ✓        |             ✓             |       ✗        |            ✗             |
| Gift cards                              |        ✓         |        ✗        |             ✗             |       ✓        |            ✗             |
| iDEAL, Wero, MB WAY, WeChat Pay         |        ✗         |        ✗        |             ✗             |       ✓        |            ✓             |
| Pay by Bank (Europe)                    |        ✗         |        ✗        |             ✗             |       ✓        |            ✓             |

The authoritative copy is `PAYMENT_METHOD_CAPABILITIES` in `packages/platform/lifecycle.ts`; the
in-app wiki renders it. **Re-check it against https://docs.adyen.com/payment-methods every three
months** and bump `CAPABILITIES_REVIEWED_ON`: a test fails once the review is over 92 days old.

- Multiple partial captures also need Adyen Support to enable them on the merchant account. Without
  that, a partial capture is the last one: Adyen cancels the rest.
- Refunds never total more than what was captured. Refund needs a capture; before it, cancel.
- ANCV is refunded once, in full, and only within 4 hours of capture.

## How OGAccountECOM captures

| Methods                                                  | Setting on this TEST account                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cards, wallets, Klarna, Alma, Oney, SEPA, ANCV           | **Manual capture** (owner, 2026-10-09): authorised until captured      |
| PayPal                                                   | **Immediate capture** (owner, 2026-10-10), although manual is possible |
| iDEAL, Wero, MB WAY, WeChat Pay, Pay by Bank, gift cards | Captured on authorisation (no separate capture, or not used here)      |

Multiple partial captures are enabled on OGAccountECOM: a second partial capture was accepted on
2026-10-10 (CAPTURE success=true).

The Back Office warns on every manually captured order. If manual capture is not what an integration
needs, set the capture delay to immediate in the Customer Area (for the merchant account, or per
payment method), or send `captureDelayHours` with each payment.

## Modifications are asynchronous and idempotent

- `/captures`, `/cancels` and `/refunds` answer `received`. The CAPTURE, CANCELLATION and REFUND
  webhooks are the outcome; CAPTURE_FAILED, REFUND_FAILED and REFUNDED_REVERSED can overturn a
  success days later.
- Send an `Idempotency-Key` (UUID v4, at most 64 characters) per intent and reuse it on retry. Adyen
  keeps keys 7 to 14 days and returns the first response to a repeat; a repeat still in flight gets
  HTTP 409 or 422 with error code 704. A response with `transient-error: true` can be retried with
  the same key.

---
type: Glossary
title: Glossary
description: "Short definitions of the terms used across the code and this bundle."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
---

# Glossary

- **Advanced flow**: the server calls `/paymentMethods`, `/payments` and `/payments/details`; Adyen
  Web only renders and encrypts.
- **API only**: the merchant's own form with Adyen's Custom Card secured fields; the server sends
  the encrypted values to `/payments`.
- **Attempt**: one authorisation try on an order, with its PSP reference and result.
- **Back Office**: the digital page listing orders, their timeline and lifecycle actions.
- **Correlation id**: the id every log row hangs off; for an order, its own id.
- **Drop-in / Components**: Adyen Web's all-methods list, or one method's component on its own.
- **HMAC key**: the per-webhook-endpoint key Adyen signs notifications with.
- **Inspector**: the side panel on the flow pages showing callbacks, API calls and webhooks.
- **Island**: a Fresh component hydrated in the browser; everything in it is public.
- **MIT**: merchant-initiated transaction, a `/payments` call with a stored payment method and
  `ContAuth`, without the shopper.
- **Modification**: a capture, cancel or refund on an existing payment.
- **Order**: one checkout, with an amount and a state derived by `resolveOrder`.
- **originalReference**: in a modification webhook, the PSP reference of the payment it applies to.
- **Payment part**: one authorised PSP reference recorded on an order.
- **Pay by Link**: an Adyen-hosted payment page created with `/paymentLinks`.
- **Profile**: a set of TEST credentials (API key, merchant account, client key, HMAC key); the
  default comes from env, others are added in Settings and stored encrypted.
- **PSP reference**: Adyen's unique id for a payment or a modification.
- **Secured fields**: Adyen-hosted iframes for card number, expiry and CVC; card data never reaches
  this server.
- **Sessions flow**: one `/sessions` call; Adyen Web runs the rest, including 3DS.
- **sessionResult**: the opaque value Adyen Web returns at the end of a Sessions payment, used to
  fetch the outcome from `GET /sessions/{id}`.
- **Settled**: an order in `paid` or `cancelled`, which no later event changes.
- **shopperReference**: the shopper id stored methods are attached to; here
  `playground-shopper-<Monday>`, rotating weekly.

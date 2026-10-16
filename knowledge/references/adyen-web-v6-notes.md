---
type: Reference
title: "Adyen Web v6: behaviour this repo relies on"
description: "Where callbacks must be configured, what beforeSubmit's resolve does, how the package is laid out on disk, why ad blockers hit it in dev, which errors are not failures, and recent version notes."
tags: [reference, adyen-web, drop-in]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-16T14:30:00Z
sources:
  - id: workbench
    resource: apps/adyen-digital/islands/FlowWorkbench.tsx
    title: Callbacks and configuration in use
  - id: methods
    resource: packages/ui/paymentMethods.ts
    title: Per-method configuration and non-fatal errors
  - id: releases
    resource: https://github.com/Adyen/adyen-web/releases
    title: Adyen Web release notes
---

# Adyen Web v6 notes

## Configuration levels

- **`AdyenCheckout(...)`**: environment, client key, locale, country, amount,
  `paymentMethodsResponse` or `session`, and the flow callbacks (`onSubmit`, `onAdditionalDetails`,
  `onPaymentCompleted`, `onPaymentFailed`, `onError`, `onChange`, `beforeSubmit`). Unknown keys only
  produce a console warning.
- **Card level** (`paymentMethodsConfiguration.card`/`scheme` for Drop-in, the Card's own props
  otherwise): `onBinLookup`, `onBinValue`, `onBrand`, installments, holder name, store details. Set
  on `AdyenCheckout`, these never fire.
- A redirect-only method mounted as a single Component needs an explicit `type`, or
  `state.data.paymentMethod` comes back empty.

## Callback semantics

- `beforeSubmit(state, component, actions)`: whatever `actions.resolve(x)` receives becomes the
  payload. `resolve()` with nothing submits no `paymentMethod`.
- `onSubmit`/`onAdditionalDetails` (Advanced): call the backend, then `actions.resolve(response)` or
  `actions.reject()`.
- `onPaymentCompleted`/`onPaymentFailed` are terminal. In Sessions they carry `sessionResult`.
- Partial payments: after a payment whose `order.remainingAmount` is above zero, Adyen Web applies
  the order to the checkout (`core.update({ order })`, or in Advanced `onPaymentMethodsRequest` then
  the update) and only then calls `onOrderUpdated({ order })`, never `onPaymentCompleted`. A
  component mounted from `onOrderUpdated` charges only what is left; a lone Giftcard component just
  empties. Without a session and without `onBalanceCheck`, Giftcard skips the balance check and
  submits the full amount. `onOrderCancel(data, { resolve, reject })` expects `resolve({ amount })`.
- `onError` also receives non-failures: `SCRIPT_ERROR` and `SDK_ERROR` (a wallet SDK that cannot
  load here) and `CANCEL` (the shopper closed a wallet sheet).

## Package layout and its consequences

- `dist/es/` is ~620 small modules; `core/Analytics/*.js` among them. Served unbundled, ad blockers
  block those and the import fails ([ADR-006](../decisions/ADR-006-adyen-web-one-bundle-in-dev.md)).
- Adyen Web vendors its runtime Preact and classnames under `dist/es/external/`; its npm `preact`
  dependency matters for resolution and types, not at runtime
  ([ADR-004](../decisions/ADR-004-one-adyen-web-and-one-preact.md)).
- `analytics: { enabled: false }` still sends one call to `checkoutanalytics-test.adyen.com`;
  blocking it is harmless.
- `components` is a namespace of every payment method class; registering all of them
  (`packages/ui/registerPaymentMethods.ts`) avoids a per-method whitelist.

## Versions

- 6.41.0: healthcare data in `onBinLookup`, stricter callback types.
- 6.42.0: WebAuthn and SPC attributes on the 3DS2 iframe; `paymentListDisplayed` analytics event.
- 6.45.0: Sessions `onReview` callback; Google Pay CSP nonce; Drop-in methods keep their state.
  6.45.1 is flagged "do not use" upstream (payment action mounting); 6.45.2 fixes it.
- 6.46.0: configurable disclaimer above the Pay button; Japanese address fields; pins `preact`
  10.29.8; `adyen.css` adds three tokens and changes `color-label-highlight` to `#00112c`.
- 6.47.0 (pinned): a failed gift card balance check is shown to the shopper; gift cards take
  per-brand placeholders; `CoreConfiguration.suppressConfigWarnings` silences the new warning about
  several AdyenCheckout instances on one page; `adyen.css` adds `animation-duration-slow` (`.25s`,
  the Drop-in expand transition); same `preact` 10.29.8.

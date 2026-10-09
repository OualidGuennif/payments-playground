---
type: Component
title: "packages/ui: browser-safe components, tokens and Adyen Web setup"
description: "What packages/ui provides to every app's islands: design tokens and shell components, the CSRF-aware fetch helper, per-method Adyen Web configuration and the registration of every Adyen Web component."
tags: [component, ui, adyen-web]
status: stable
scope: component-ui
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: ui
    resource: packages/ui
    title: The package
---

# packages/ui

Safe for the browser; nothing secret is importable from here.

| Module                      | Responsibility                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.css`                | Design tokens and shared layout (checkout shell, inspector, Back Office).                                                                                                                                                                                              |
| `components.tsx`            | Shell pieces: header, TEST banner, page header, callouts, status pills, the footer that names the Adyen Web and Checkout API versions.                                                                                                                                 |
| `client.ts`                 | `apiFetch` (adds `X-CSRF-Token` from the `adyen_csrf` cookie and `X-Profile-Id`), `formatMinorAmount` (currency-exponent aware), `prettyJson`.                                                                                                                         |
| `paymentMethods.ts`         | Per-method Drop-in/Component configuration: card (holder name, store details, BR social security number, installments in BR/MX/JP), Google Pay merchant id, PayPal, Klarna, iDEAL, SEPA; `isNonFatalWalletError` (script, SDK and cancel errors do not stop the flow). |
| `registerPaymentMethods.ts` | `AdyenCheckout.register(...Object.values(components))`: every method Adyen Web ships, so a method newly enabled in the Customer Area renders without a code change. Imported for its side effect before the first `AdyenCheckout()`.                                   |

The Adyen Web version is pinned in the root `deno.json`; `packages/ui` resolves it through the root
import map, which is why every app must pin the same version
([ADR-004](../decisions/ADR-004-one-adyen-web-and-one-preact.md)).

---
type: Component
title: "packages/ui: browser-safe components, tokens and Adyen Web setup"
description: "What packages/ui provides to every app's islands: design tokens and shell components, the CSRF-aware fetch helper, per-method Adyen Web configuration and the registration of every Adyen Web component."
tags: [component, ui, adyen-web]
status: stable
scope: component-ui
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T06:30:00Z
sources:
  - id: ui
    resource: packages/ui
    title: The package
---

# packages/ui

Safe for the browser; nothing secret is importable from here.

| Module                      | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.css`                | Light and dark token sets ([ADR-010](../decisions/ADR-010-one-theme-attribute-and-token-sets.md)) and the shared shell, forms and buttons.                                                                                                                                                                                                                                                                                                                                        |
| `components.tsx`            | `AppShell`: a floating glass header (wordmark and TEST pill, Home and Back Office, theme toggle, settings, a menu on mobile) or, with `minimal` (digital), only Home and Back Office on inner pages plus the theme toggle and settings; a one-line footer (versions, Wiki, Adyen docs, Disclaimer, and the TEST pill when the header has none), `ThemeScript`, `ThemeToggle`, page header, callouts, status pills, the footer that names the Adyen Web and Checkout API versions. |
| `client.ts`                 | `apiFetch` (adds `X-CSRF-Token` from the `adyen_csrf` cookie and `X-Profile-Id`), `formatMinorAmount` (currency-exponent aware), `prettyJson`.                                                                                                                                                                                                                                                                                                                                    |
| `paymentMethods.ts`         | Per-method Drop-in/Component configuration: card (holder name, store details, BR social security number, installments in BR/MX/JP), Google Pay merchant id, PayPal, Klarna, iDEAL, SEPA; `isNonFatalWalletError` (script, SDK and cancel errors do not stop the flow).                                                                                                                                                                                                            |
| `registerPaymentMethods.ts` | `AdyenCheckout.register(...Object.values(components))`: every method Adyen Web ships, so a method newly enabled in the Customer Area renders without a code change. Imported for its side effect before the first `AdyenCheckout()`.                                                                                                                                                                                                                                              |
| `theme.ts`                  | `THEME_SCRIPT` (inline, before paint: applies the stored or system theme, handles every toggle), `currentTheme`, the storage key and change event.                                                                                                                                                                                                                                                                                                                                |
| `testData.ts`               | Adyen's published test cards and alternative-method test data, shared by styling and digital.                                                                                                                                                                                                                                                                                                                                                                                     |
| `useCopy.ts`                | Copy to clipboard with a short "copied" state; strips spaces unless `raw`.                                                                                                                                                                                                                                                                                                                                                                                                        |

The Adyen Web version is pinned in the root `deno.json`; `packages/ui` resolves it through the root
import map, which is why every app must pin the same version
([ADR-004](../decisions/ADR-004-one-adyen-web-and-one-preact.md)).

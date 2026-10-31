---
type: Component
title: "packages/ui: browser-safe components, tokens and Adyen Web setup"
description: "What packages/ui gives every app's pages and islands: design tokens and shell components, the theme bootstrap, the CSRF-aware fetch helper, per-method Adyen Web configuration and the registration of every Adyen Web component."
status: stable
scope: component-ui
tags: [component, ui, adyen-web]
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - resource: ../../packages/ui
    title: "The package: modules and stylesheet"
  - resource: ../../packages/ui/client.ts
    title: "apiFetch, readCookie, formatMinorAmount, prettyJson"
  - resource: ../../packages/ui/components.tsx
    title: "AppShell and the shared page components"
  - resource: ../../packages/ui/theme.ts
    title: "THEME_SCRIPT, currentTheme, the storage key and change event"
  - resource: ../../packages/ui/paymentMethods.ts
    title: "Per-method Adyen Web configuration and the wallet error filter"
  - resource: ../../packages/ui/registerPaymentMethods.ts
    title: "Registering every component Adyen Web ships"
  - resource: ../../packages/ui/styles.css
    title: "The light and dark token sets"
  - resource: ../decisions/ADR-004-one-adyen-web-and-one-preact.md
    title: "One Adyen Web and one Preact across the workspace"
  - resource: ../decisions/ADR-010-one-theme-attribute-and-token-sets.md
    title: "Dark mode is one data-theme attribute over two token sets"
  - resource: ../../apps/adyen-digital/islands/FlowWorkbench.tsx
    title: "The focus app's Drop-in and Components usage"
  - resource: ../../apps/adyen-v6-styling/components/adyenOptions.test.ts
    title: "The only automated check of an Adyen Web surface"
---

# packages/ui

## Intent

The browser-safe half of the shared code: the design tokens and shell every page renders, the theme
bootstrap that runs before paint, the fetch helper that carries the CSRF token, and the Adyen Web
configuration that makes Drop-in and the individual Components look and behave the same in every
playground. Nothing secret is importable from here.

Two boundaries define the package.

- **Design tokens.** Colours and surfaces exist once, as token sets in `styles.css`: light under
  `:root`, dark under `[data-theme="dark"]`, selected by one attribute on `<html>`
  ([ADR-010](../decisions/ADR-010-one-theme-attribute-and-token-sets.md)). Apps layer their own CSS
  on top; they do not define a second palette.
- **Adyen Web.** This package configures Adyen Web and never wraps it: card fields are rendered by
  Adyen inside its own iframes, so no PAN or CVC enters this code or the DOM around it. The SDK
  version is pinned once in the root `deno.json` and resolved through the root import map, so every
  app and this package use the same `@adyen/adyen-web` and the same Preact
  ([ADR-004](../decisions/ADR-004-one-adyen-web-and-one-preact.md)).

## Data sources

| Source                                                     | What is read                                                 | Owner               | Freshness                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------- | ------------------------------------------- |
| `adyen_csrf` cookie                                        | The double-submit token, attached to mutating requests       | this server         | per `apiFetch` call                         |
| Same-origin `/api/*`                                       | JSON bodies                                                  | this server         | per call                                    |
| `localStorage["playground-theme"]`, `prefers-color-scheme` | The stored choice, else the system preference                | browser             | at load, then on toggle and system change   |
| `<html data-theme>`, `<meta name="theme-color">`           | What the page currently shows                                | this browser        | read and updated by `THEME_SCRIPT`          |
| Root `deno.json` import map                                | `@adyen/adyen-web` 6.47.0 and `preact` 10.29.8               | this repo           | pinned per release                          |
| `packages/platform/markets.ts`                             | `ZERO_DECIMAL_CURRENCIES`                                    | this repo           | static; the only platform import, pure data |
| Adyen's published TEST credentials                         | Card numbers and alternative-method samples in `testData.ts` | Adyen documentation | copied by hand, so it can drift             |
| `styles.css`                                               | The token sets and shared shell, form and button styles      | this repo           | static                                      |

## Inputs

| Module                      | Surface and inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`                 | `apiFetch<T>(path, init = {}, profileId?)` takes a path, a `RequestInit` and an optional profile id. `readCookie(name)`; `formatMinorAmount(value, currency)` takes an integer in minor units and an ISO code; `prettyJson(value)`.                                                                                                                                                                                                                                                                                     |
| `components.tsx`            | `AppShell({ title, currentPath, children, compact?, minimal? })`; `TestDataAndTools()`; `DisclaimerPage({ appName, repositoryUrl? })`; `ThemeScript()`; `ThemeToggle()`; `TestPill()`; `PlaygroundWordmark({ label })`; `PageHeader({ eyebrow?, title, description, actions? })`; `StatusPill({ children, tone? })`; `EmptyState({ title, description, children? })`; `Field({ label, hint?, htmlFor, children })`; `ColorField({ label, htmlFor, value, onChange })`; `Callout({ title, children, tone?, compact? })`. |
| `paymentMethods.ts`         | `cardConfiguration(countryCode, { enableStoreDetails? })`; `installmentsConfiguration(countryCode)`; `paymentMethodsConfiguration(countryCode, merchantAccount?, options?)`; `isNonFatalWalletError(cause)`; `INSTALLMENT_COUNTRIES` (`BR`, `MX`, `JP`); `SOCIAL_SECURITY_NUMBER_COUNTRIES` (`BR`).                                                                                                                                                                                                                     |
| `registerPaymentMethods.ts` | No inputs and no exports: importing it registers every component class Adyen Web ships.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `theme.ts`                  | `THEME_SCRIPT` (a string), `currentTheme()`, `THEME_STORAGE_KEY = "playground-theme"`, `THEME_CHANGE_EVENT = "playground-themechange"`, `type Theme = "light" \| "dark"`.                                                                                                                                                                                                                                                                                                                                               |
| `testData.ts`               | `TEST_CARDS` (`{ scheme, note?, pan, expiry, cvc }`), `ALT_METHODS` (`{ name, value?, note?, detail?, disclaimer? }`), `KLARNA_DOCS`.                                                                                                                                                                                                                                                                                                                                                                                   |
| `useCopy.ts`                | `useCopy()` returns `{ copied, copy(value, { raw? }) }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`StatusPill` tones are `neutral`, `positive`, `warning`, `danger` and `info`; `Callout` tones are
`info`, `warning` and `danger`. `ColorField` accepts `#rgb` or `#rrggbb` and only pushes a typed
value upstream once it matches.

What the configuration sends, per method: card and scheme share the card configuration (brand icon,
holder name required, no billing address, CVC visible and unmasked, placeholder hints, the social
security number field in Brazil, installments in Brazil, Mexico and Japan); Apple Pay asks for an
email; Google Pay uses `buttonType: "checkout"`, Mastercard/Visa/Amex and the fixed Business Console
merchant id `0023022202`, with the active profile's merchant account as `gatewayMerchantId`; PayPal
is a vertical black button; the three Klarna variants render without the Klarna widget; iDEAL and
SEPA show their bank image. `apiFetch` sends `Accept: application/json`,
`Content-Type: application/json` when there is a body, `X-CSRF-Token` from the `adyen_csrf` cookie
on anything but `GET`/`HEAD`, and `X-Profile-Id` when a profile id is given, always with
`credentials: "same-origin"`.

## Outputs

- **Rendered shell.** `AppShell` emits a skip link, a glass header at the top of the page that
  scrolls with it (wordmark and TEST pill, Home and Back Office, the testing-dataset menu, the theme
  toggle, settings, and a menu on mobile) and a one-line footer (Adyen Web and Checkout API
  versions, Wiki, Adyen docs, Disclaimer, and the TEST pill when the header has none). With
  `minimal`, as in digital, the header is only the theme toggle and settings, plus Home and Back
  Office on inner pages. The page content sits in `<main id="main-content">`.
- **Other page pieces.** `PageHeader` (eyebrow, title, description, actions), `StatusPill`,
  `EmptyState`, `Field`, `ColorField`, `Callout`, the `TestDataAndTools` menu (which hides the
  Chrome extension link on touch and narrow screens), the playground wordmark (deliberately not an
  Adyen logo) and `TestPill` (always "TEST" and always visible). `DisclaimerPage` renders the
  sections No real money, no real cards; Not an Adyen product; If you reuse any of it; No warranty,
  no liability.
- **Theme.** `ThemeScript` renders an inline script element, never text, so the stored or system
  theme is applied before first paint; it also sets `aria-checked` on every `[data-theme-toggle]`
  and updates the `theme-color` meta. Toggles are handled by event delegation, so no island is
  involved. `currentTheme()` returns `"light"` during SSR.
- **`apiFetch`.** The parsed body as `T`. A non-OK answer throws `Error` with the server's `error`
  string, else `Request failed (<status>).`; an unparseable body becomes
  `{ error: "Invalid server response." }`, thrown when the answer was also non-OK.
- **Formatting.** `formatMinorAmount` divides by 100 unless the currency is in
  `ZERO_DECIMAL_CURRENCIES`, then formats with `Intl.NumberFormat`; `prettyJson` is two-space JSON.
  `readCookie` returns `undefined` when there is no `document`.
- **Adyen Web.** `paymentMethodsConfiguration` returns a plain object keyed `card`, `scheme`,
  `applepay`, `googlepay`, `paypal`, `klarna`, `klarna_account`, `klarna_paynow`, `ideal`,
  `sepadirectdebit`. `isNonFatalWalletError` answers `true` for `SCRIPT_ERROR`, `SDK_ERROR` and
  `CANCEL`, so a wallet SDK that cannot load or a shopper closing the sheet does not stop the flow.
- **Registration.** Importing `registerPaymentMethods.ts` calls
  `AdyenCheckout.register(...Object.values(components))` once, for every method Adyen Web ships, so
  a method newly enabled in the Customer Area renders without a code change.
- **Copying.** `useCopy` writes the value to the clipboard, flags it as copied for 1.6 s and strips
  spaces unless `raw` is set.

### Refusals

| Refusal                                                     | Result                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A mutating `/api/*` call from `apiFetch` without its cookie | 403 from the server, surfaced as a thrown `Error`                               |
| A non-OK API answer                                         | thrown `Error` with the server's message                                        |
| A response body that is not JSON                            | `{ error: "Invalid server response." }`, thrown when the answer was also non-OK |
| Clipboard permission denied                                 | nothing is thrown and the value stays readable                                  |
| A half-typed hex colour                                     | no `onChange`, so the upstream value does not blank out                         |

## Invariants

This package has no test file of its own. Each invariant names the check that actually holds it, and
says when only one half is covered.

1. Every app's rendered page contains a `<main>` element and the TEST marker —
   `deno task ssr:assert` (`tools/build/assert-built-ssr.ts`, run per app).
2. These modules type-check under the workspace's Preact and JSX settings, and each app bundles them
   for the browser without a server-only import — `deno task types` and `deno task build`.
3. The mutation contract `apiFetch` implements is enforced server-side: a request without a matching
   `adyen_csrf` cookie and `X-CSRF-Token` header gets 403 and no cookies, so the helper's header is
   load-bearing — `packages/platform/security.test.ts` "CSRF still rejects a cross-origin POST that
   carries a valid token" and "a rejected POST issues no cookies, so it cannot replace bootstrap's
   CSRF token". The client half is not unit-tested.
4. The Adyen Web token surface the styling workbench offers on top of these tokens matches the real
   `adyen.css` of the pinned SDK, so a version bump cannot silently drop or rename a token —
   `apps/adyen-v6-styling/components/adyenOptions.test.ts`, the only automated check of an Adyen Web
   surface.
5. The zero-decimal set that `formatMinorAmount` branches on is exactly the currencies without a
   minor unit — `packages/platform/markets.test.ts` "zero-decimal currencies are never given
   fractional minor units". The formatter's own branch has no test.

## Determinism

**Deterministic** for everything rendered from props: `AppShell` and the other components are pure
functions of their props and `currentPath`, the configuration builders are pure functions of the
country, merchant account and options, and `formatMinorAmount` and `prettyJson` depend only on their
arguments. The theme is deterministic for a given stored choice and system preference, applied by
one script before paint rather than by hydration.

**Bounded** at the network edge: `apiFetch` parses JSON and returns it as `T` under the server's
contract; an unreadable body is reported as `Invalid server response.`, never treated as an empty
object. `isNonFatalWalletError` narrows an unknown cause to three known names, and anything else
stays fatal.

**Adaptive** is not used: no model, no generated markup and no free-text authority in this package.

## Acceptance checks

```bash
deno task types         # every component and helper type-checks
deno task build         # the four apps bundle this package for the browser
deno task ssr:assert    # <main> and the TEST marker in every built page
deno task test          # the server-side half of the CSRF contract, and the market fixtures
deno task check         # the full gate, including fmt and lint over packages/ui
```

## Out of scope

- Any secret: no API key, HMAC key, bearer token or server session is importable here.
- Collecting card data or touching Adyen's iframes; Adyen Web owns those fields.
- Calling Adyen directly; every call goes through this server's `/api/*`.
- Defining a second theme mechanism, palette or CSS-in-JS layer.
- Bundling a second copy of Adyen Web or Preact, or choosing its version locally.
- App-specific layout, copy or routes; those live in `apps/<app>/`.
- Guaranteeing that the published test credentials in `testData.ts` stay current.

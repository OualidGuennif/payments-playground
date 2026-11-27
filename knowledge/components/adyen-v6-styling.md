---
type: Component
title: "adyen-v6-styling: a live theming workbench for the Adyen Web Drop-in"
description: "The Drop-in Styling playground: secured-field styles, component options, design tokens, JSON and CSS exports, and the API, client component and token-audit test that carry them."
tags: [component, styling, drop-in, adyen-web]
status: stable
scope: component-adyen-v6-styling
generated:
  by: claude-code/opus-5.5
  at: 2026-11-28T09:00:00Z
sources:
  - id: app
    resource: ../../apps/adyen-v6-styling
    title: "The app: Next pages, Elysia API, components"
  - id: api
    resource: ../../apps/adyen-v6-styling/src/server/api.ts
    title: The two /api/styling routes, the session request and the exported handler
  - id: proxy
    resource: ../../apps/adyen-v6-styling/src/proxy.ts
    title: Basic Auth before the pages; the API answers its own in serveSecurely
  - id: island
    resource: ../../apps/adyen-v6-styling/src/components/StylingPlayground.tsx
    title: The panel, the Drop-in mounts and localStorage persistence
  - id: panels
    resource: ../../apps/adyen-v6-styling/src/components/panels
    title: "The three tabs (Field styles, Components, Theme), their option groups and the raw output block"
  - id: styles
    resource: ../../apps/adyen-v6-styling/src/styles
    title: The app's stylesheets by area, imported from src/app/layout.tsx in cascade order
  - id: options
    resource: ../../apps/adyen-v6-styling/src/options
    title: "Option catalogue by area (controls, secured fields, CSS tokens, Drop-in, card, wallets, themes), exports and Drop-in props; split out of components/adyenOptions.ts on 2026-11-25"
  - id: token-test
    resource: ../../apps/adyen-v6-styling/src/options/css-tokens.test.ts
    title: The adyen.css token audit
  - id: routes
    resource: ../../apps/adyen-v6-styling/src/app
    title: Layout, home and disclaimer pages, and the route files that hand requests to Elysia
  - id: next-config
    resource: ../../apps/adyen-v6-styling/next.config.ts
    title: Standalone output, shared packages, page security headers
  - id: readme
    resource: ../../apps/adyen-v6-styling/README.md
    title: Environment variables, panel tabs, exports and troubleshooting
verified:
  - at: 2026-11-25
    check: "After the reorganization (dev :8004, TEST): three tabs, their groups and exports (Theme header 6.48.1), a Card fields toggle updates the JSON, Brazil market group, light and dark, 375 and 1440 px, no errors. No payment."
---

# adyen-v6-styling

## Intent

A theming workbench for the Adyen Web Drop-in: the live checkout sits beside every option Adyen
exposes, and the result leaves as a JSON config, a CSS file, or both. It exists so a merchant can
see the effect of a `styles` object, a `--adyen-sdk-*` token or a wallet option before copying it
into a real integration. Status: Ready; deployed at `https://styling.payments-playground.com`, and
`bun run dev:styling` runs it on port 8004 (Next.js 16 on Bun, [ADR-012](../decisions/ADR-012-agentic-app-on-bun-and-next.md)) ([README](../../apps/adyen-v6-styling/README.md)).

It is not an order playground. There is no Back Office and no order UI. It creates one TEST session,
mounts a Drop-in, and keeps the panel's settings in `localStorage`; the server still writes the
order, `payment_sessions` and `api_calls` rows it needs to mint and record that session.

## Data sources

| Source                                                          | What is read                                                                                             | Owner      | Freshness                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `packages/platform/base-api.ts` `GET /api/bootstrap`            | Selected public profile, publishable `test_` client key, `publicOrigin`, webhook URL                     | Platform   | Once per page load                 |
| `POST /api/styling/session` in `api.ts`                         | A new Adyen TEST session; creates the order, session and API-call rows                                   | App        | Initial load, market change, reset |
| `POST /api/styling/payment-methods` in `api.ts`                 | The merchant's available methods for one market, only for the "pre-select method" dropdown               | App        | On country change after bootstrap  |
| Adyen Checkout TEST `/paymentMethods` and `/sessions`           | Method eligibility and session token                                                                     | Adyen      | Live, per request                  |
| Browser `localStorage`, key `adyen-v6-styling.panel.v1`         | Country, locale, tab, secured styles, tokens, class rules, native/card/wallet options and `showDonation` | Browser    | Written on every change            |
| `src/options/*.ts`                                              | Defaults, property/token catalogues, theme presets, `dropinProps`, config and CSS renderers              | Repository | Shipped with the build             |
| `https://checkoutshopper-live.cdn.adyen.com/.../adyen.css`      | Token names and default fallbacks for the pinned Adyen Web version; test only                            | Adyen      | `bun test` (needs network)         |
| Adyen Web callbacks (`onPaymentCompleted`, `onError`, donation) | Whether the preview is spent and what Adyen Giving reported                                              | Adyen Web  | In the browser                     |

There is no webhook and no HMAC key: the app never settles an order server-side. Only
`src/app/api/[[...slugs]]` and `src/app/healthz` hand requests to Elysia, so `/webhook` is not a
route here.

## Inputs

### HTTP

| Route                               | Body                                                                               | Rules                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/styling/payment-methods` | `{ "countryCode"?: unknown }`                                                      | Country is normalised to an ISO-3166 alpha-2 market, falling back to the supported European default. Requires a merchant account, else `409`.                                                           |
| `POST /api/styling/session`         | `{ "countryCode"?: unknown, "shopperLocale"?: unknown, "installments"?: unknown }` | `shopperLocale` must match `^[a-z]{2}-[A-Z]{2}$`, else `en-US`. `installments` is used only when exactly `true` and the market is BR, MX or JP. Requires a merchant account and client key, else `409`. |

Both mutations need the CSRF double-submit header (`X-CSRF-Token`, sent by the Eden client
`apiClient` in `packages/ui/client.ts`). `X-Profile-Id`
selects a non-default profile. Amount and currency are never client input: they come from
`defaultAmountForCountry` and `currencyForCountry`.

The session request is built server-side with these fields:

```jsonc
{
  "merchantAccount": "<selected profile>",
  "amount": { "value": 1234, "currency": "EUR" },
  "reference": "styling-<epoch ms>-<id prefix>",
  "countryCode": "FR",
  "shopperLocale": "fr-FR",
  "shopperReference": "playground-shopper-<week>",
  "shopperEmail": "<test shopper>",
  "lineItems": [/* buildLineItems(amount) */],
  "storePaymentMethodMode": "askForConsent",
  "recurringProcessingModel": "CardOnFile",
  "channel": "Web",
  "returnUrl": "<publicOrigin>/",
  "billingAddress": {/* buildCheckoutAddresses */},
  "deliveryAddress": {/* same, firstName "Test", lastName "Shopper" */},
  "installmentOptions": { "card": { "values": [1, 3, 5] } } // BR/MX/JP only
}
```

`sessionRiskFields(countryCode)` is spread in last. The call uses one `crypto.randomUUID()` as its
idempotency key.

Deployment variables: `PUBLIC_ORIGIN` anchors the CSRF check and the session `returnUrl`,
`PROFILE_ENCRYPTION_KEY` is required on Render for extra profiles,
`SESSION_SIGNING_SECRET` signs the session/CSRF cookies, `DATABASE_PATH` defaults to
`./data/styling.sqlite`, and `PLAYGROUND_BASIC_AUTH_*` puts the whole app behind Basic Auth. The
platform also serves `GET /api/health` and `GET /healthz`.

### Panel

The exact types are exported by the modules in
[`src/options/`](../../apps/adyen-v6-styling/src/options) (`SecureStyles` in `secured-fields.ts`,
`CssTokens` in `css-tokens.ts`):

- `SecureStyles = Record<SecureState, Partial<Record<SecureProperty, string>>>` for the four states
  `base`, `placeholder`, `error`, `validated`, with the properties in `SECURE_PROPERTY_SPECS`.
- `CssTokens = Record<string, string>` keyed by `CSS_TOKEN_SPECS`; each key is emitted as
  `--adyen-sdk-<token>`.
- `CssRules` (`payButtonBackground`, `payButtonColor`, `methodSpacing`, `uppercaseButton`,
  `compactMethods`), `NativeOptions`, `CardOptions` and `WalletOptions`.
- `THEME_PRESETS` entries carry `secure`, `tokens`, `wallets` and `showDonation`; the picker derives
  `Custom` from the current values with `themeSignature`.

The persisted blob is the `Persisted` object in `StylingPlayground.tsx`: `country`, `locale`,
`localeManual`, `section` (`styling`, `configuration` or `css`), `secureStyles`, `cssTokens`,
`cssRules`, `nativeOptions`, `cardOptions`, `walletOptions`, `showDonation`. The key is versioned; a
blob from an older build is restored over the current defaults, never instead of them.

## Outputs

### Pages

| Path          | What                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `/`           | The toolbar (Country, Locale, Theme, light/dark switch), the live Drop-in, test cards and the three-tab panel |
| `/disclaimer` | The shared TEST disclaimer, with its own back link and theme switch because this app has no shared shell      |

The toolbar is four glass blocks at the top of the preview column, sharing the checkout's edges. The
TEST pill and Adyen Web version sit in the footer. The preview, the panel and the footer stand in
one centred frame of at most 1440 px (`--page-max-workbench`, UI policy page width), so a wider
window adds margin on both sides and the panel keeps 340 to 400 px from 1180 px up: the test data
and the Drop-in stay side by side from about 1375 px. The panel has three tabs: **Field styles**,
**Components** and **Theme**; **Reset** asks first and clears the persisted blob. Dark mode darkens
the tool around the preview but the Drop-in column keeps the light tokens (`.keep-light`,
`color-scheme: light`, ADR-010); a dark checkout is the **Dark** theme preset, chosen by hand.

### API and files

| Output                              | Shape                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/styling/payment-methods` | `200 { "paymentMethods": [{ "type": string, "name": string }] }`                                                                                                            |
| `POST /api/styling/session`         | `201 { "correlationId": string, "session": <Adyen session> }`; `session.id`, `session.sessionData` and `session.expiresAt` are what the component and the row use           |
| Field styles export                 | JSON with `card`, `storedCard`, `giftcard` and `bcmc`; the last two carry the same secured-field `styles`                                                                   |
| Components export                   | JSON with `card` and only the wallet objects that were changed (`applepay`, `googlepay`, `paypal`)                                                                          |
| Theme export                        | `adyen-overrides.css`, to import after `@adyen/adyen-web/styles/adyen.css`: `.adyen-checkout` tokens, the Apple Pay radius block, pay-button rules and the class-name rules |

The secured-field styles also go to `giftcard` and `bcmc`, in the preview and in the exported JSON:
their digits are typed into the same Adyen iframes, and without the styles they stayed dark on the
Dark preset (2026-10-16). Wallet buttons are drawn by Apple, Google and PayPal, so neither the page
CSS nor the secured styles reach them; only each vendor's options do.

### Refusals

| Status | When                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| `401`  | Optional Basic Auth is configured and the challenge is not answered                                         |
| `403`  | CSRF token missing/mismatched, or the request's origin is not this app's host                               |
| `409`  | No merchant account, or `/sessions` without a merchant account and a client key                             |
| `429`  | More than 120 requests a minute for one client and path                                                     |
| `500`  | Adyen rejected the call or an unexpected error; Elysia answers `{ "error": string, "correlationId": string }` |

The playground component also shows a configuration error when bootstrap has no client key or the profile is
incomplete. `onPaymentFailed` is deliberately empty: Adyen Web owns the failure UI.

## Invariants

| #  | Invariant                                                                                                                                                                                           | Test / file                                                                                              |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1  | TEST only: a LIVE host or client key is refused before any call.                                                                                                                                    | `packages/platform/test-only.ts`; `AdyenTestClient` in `packages/platform/adyen.ts`                      |
| 2  | Every custom property the panel offers is read by the pinned `adyen.css`, no token it reads is missing, and each shown default matches the stylesheet.                                              | `src/options/css-tokens.test.ts`, the three `adyen.css 6.48.1` tests                                    |
| 3  | The secured-field styles reach `card`, `storedCard`, `giftcard` and `bcmc` in the preview and the Field styles export.                                                                              | `securedFieldMethodConfigObjects` in `src/options/card.ts`, `dropinProps` in `src/options/dropin-props.ts`|
| 4  | A theme preset changes only secured styles, tokens, wallet options and donation, and clears class-name rules; it never changes Drop-in behaviour or card fields, and never ships a class-name rule. | `applyTheme` in `src/components/StylingPlayground.tsx`; `THEME_PRESETS` in `src/options/themes.ts`         |
| 5  | The selected theme is derived from the values: any hand edit makes the picker read `Custom`, with no separate flag.                                                                                 | `themeSignature`, `activeTheme` in `src/components/StylingPlayground.tsx`                                       |
| 6  | Country and locale are session-bound: changing either fetches a new `/sessions`; style-only changes remount the Drop-in against the same Core.                                                      | `refreshSession`, `remountDropinOnly`, the two 400 ms debounces in `src/components/StylingPlayground.tsx`       |
| 7  | A superseded mount cannot install itself over a newer one.                                                                                                                                          | `mountToken` in `src/components/StylingPlayground.tsx`                                                          |
| 8  | A spent session is never mounted again: New payment, Reset and a remount after completion fetch a fresh session.                                                                                    | `sessionSpent`, `remountDropinOnly`, `reset` in `src/components/StylingPlayground.tsx`                          |
| 9  | Panel state survives a reload, restores over defaults, and Reset is the only way to clear it (after confirmation).                                                                                  | `STORAGE_KEY`, `stored`, `clearStored`, `reset` in `src/components/StylingPlayground.tsx`                       |
| 10 | The preview keeps the configured look in dark mode: only the surrounding tool follows the theme.                                                                                                    | `.keep-light` in `packages/ui/styles.css`; [ADR-010](../decisions/ADR-010-one-theme-attribute-and-token-sets.md) |
| 11 | No order is settled in this app: there is no `/webhook` route, and the result is only Adyen Web's callback.                                                                                         | `src/app` (no webhook route); `mountDropin` in `src/components/StylingPlayground.tsx`                                              |
| 12 | Every mutation carries the CSRF token; a cross-origin POST is refused even with a valid token.                                                                                                      | `packages/platform/security.test.ts`; `apiClient` in `packages/ui/client.ts`                              |

The token audit needs network access. Offline it fails on the fetch, not on a real regression
([README](../../apps/adyen-v6-styling/README.md)).

## Determinism

Deterministic in code, with two external inputs: the Adyen TEST session/method list and the
browser's `localStorage`. `cssText`, the card/stored-card/wallet config objects and the theme
signature are pure functions of the panel state, so the same state exports the same bytes. No model
is involved.

Adyen can change method eligibility or a session between loads; the pinned Adyen Web version and the
token audit catch the part that is checkable (the shipped `adyen.css`). The page renders the
playground in the browser only (`ClientPlayground`, `ssr: false`): its first state comes from
`localStorage` and the browser's languages, which a server render could only contradict.

## Acceptance checks

```bash
bun run --cwd apps/adyen-v6-styling typecheck
bun test apps/adyen-v6-styling          # needs network: the adyen.css token audit
bun run build:styling
bun run dev:styling
```

Manual pass: load `/`, change a field style and a token, export both, complete a TEST card payment,
then confirm **New payment** returns a payable Drop-in and **Reset** asks before clearing. A pass is
not a statement that Adyen accepted a particular style, only that the panel produced the config.

## Out of scope

- No Back Office, order lifecycle, capture/cancel/refund, webhook or HMAC. The created order exists
  to carry the session, not to be operated.
- No `redirectResult` handling: a redirect method returns to `/` and the playground component starts a new preview
  session; it does not settle the previous one.
- No server-side persistence of panel settings, and no multi-user or shared theme storage.
- No styling inside Adyen-hosted secured-field iframes from page CSS, and no styling of
  provider-drawn wallet buttons beyond their own options.
- No guarantee that class-name rules survive an Adyen Web upgrade; they are marked as private API in
  the UI and never included by a preset.
- No production/LIVE path, no Apple Pay outside Safari with a verified domain and Apple sandbox
  account, and no claim that an exported stylesheet matches a merchant's own build.

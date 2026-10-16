# Current work

Task state only. Durable facts belong in `knowledge/`; history belongs in `git log`.

- **Updated**: 2026-10-16
- **Focus**: `apps/adyen-digital` (owner instruction). Styling only when asked; agentic out of
  scope.
- **Render**: services renamed to the YAML names, Blueprint Auto Sync off, auto-deploy from git on.
  A push to `main` deploys.
- **Session closed 2026-10-10.** Shipped: the digital redesign and dark mode
  ([ADR-010](../knowledge/decisions/ADR-010-one-theme-attribute-and-token-sets.md)), redirect
  returns settled through `/result`, Digital Checkout marked Ready, styling's four-block glass
  toolbar and a Dark theme preset, page glows on every app and non-sticky headers, and the rebuilt
  inspector (Adyen events only, one row per onChange with its diff, cURL, export), and captures,
  cancels and refunds as a webhook-settled ledger (partial and multiple partial, idempotent). All
  pushed; Render deploys from `main`.
- **2026-10-16 (later)**: "Try again" after a refusal reuses the checkout (same session, same gift
  card order); sessions expire after 25 minutes.
- **2026-10-16**: Adyen Web 6.47.0 (commit kept local until the owner looks at styling: one new
  Motion token, Drop-in 3 px shorter, same computed styles). Gift card partial payments work in
  Sessions and Advanced, Drop-in and Components (onOrderUpdated banner and card; Advanced balance,
  order, cancel and payment-methods callbacks). The random dev reloads (the owner saw them in
  Firefox too) were Fresh's plugin reacting to SQLite writes; every app's Vite now ignores
  `*.sqlite*`.
- **2026-10-15**: "Native 3DS" switch in the settings sheet (Sessions, Advanced; on by default), off
  sends `nativeThreeDS: "disabled"`; redirect 3DS browser verified for both flows. Home cards read
  "Sessions Flow" and "Advanced Flow".
- **2026-10-15**: Sessions no longer calls `GET /sessions/{id}` (its status is not updated, per
  Adyen's reference as quoted by the owner); the route, client sync and cURL/inspector special cases
  are gone, and a statement in `SCHEMA_SQL` deletes the recorded calls at every start, so
  production's database is cleaned on deploy. A Sessions order is now settled only by its
  AUTHORISATION webhook (or `/payments/details` after a redirect): locally, without webhooks, it
  stays `open`.
- **2026-10-13**: Advanced `/payments` now sends `shopperIP` (X-Forwarded-For, else the connection;
  a dev-only Vite plugin supplies it locally) and a `deliveryAddress` without `firstName`/`lastName`
  (Sessions keeps them). Browser verified on 5173; the IP behind Render's proxy is not observed yet:
  check one production `/payments` in the inspector after the deploy.
- **Waiting on the owner**: a look at production after the last deploy (styling on a phone in dark
  mode especially); confirm Drop-in in Firefox with Adblock Plus.
- **Open from this session**: a webhook row in the new inspector is not observed in a browser yet
  (webhooks only reach production); on a dark Drop-in, Click to Pay's panel stays white in styling
  (Adyen hard-codes it, presets ship no CSS rules).
- **Next candidates** (from [current/digital-status.md](../knowledge/current/digital-status.md)):
  update `lifecycle_actions` from responses and webhooks; model refunds; a webhook.site-to-local
  relay so real notifications reach the dev server without a tunnel.

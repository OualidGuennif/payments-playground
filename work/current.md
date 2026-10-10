# Current work

Task state only. Durable facts belong in `knowledge/`; history belongs in `git log`.

- **Updated**: 2026-10-10
- **Focus**: `apps/adyen-digital` (owner instruction). Styling only when asked; agentic out of
  scope.
- **Render**: services renamed to the YAML names, Blueprint Auto Sync off, auto-deploy from git on.
  A push to `main` deploys.
- **Session closed 2026-10-10.** Shipped: the digital redesign and dark mode
  ([ADR-010](../knowledge/decisions/ADR-010-one-theme-attribute-and-token-sets.md)), redirect
  returns settled through `/result`, Digital Checkout marked Ready, styling's four-block glass
  toolbar and a Dark theme preset, page glows on every app and non-sticky headers, and the rebuilt
  inspector (Adyen events only, one row per onChange with its diff, cURL, export). All pushed;
  Render deploys from `main`.
- **Waiting on the owner**: a look at production after the last deploy (styling on a phone in dark
  mode especially); confirm Drop-in in Firefox with Adblock Plus.
- **Open from this session**: a capture clicked in the redesigned Back Office and a webhook row in
  the new inspector are not observed yet (webhooks only reach production); on a dark Drop-in, Click
  to Pay's panel stays white in styling (Adyen hard-codes it, presets ship no CSS rules).
- **Next candidates** (from [current/digital-status.md](../knowledge/current/digital-status.md)):
  update `lifecycle_actions` from responses and webhooks; model refunds; a webhook.site-to-local
  relay so real notifications reach the dev server without a tunnel.

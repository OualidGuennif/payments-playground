# Current work

Task state only. Durable facts belong in `knowledge/`; history belongs in `git log`.

- **Updated**: 2026-10-10
- **Focus**: `apps/adyen-digital` (owner instruction). Styling only when asked; agentic out of
  scope.
- **Render**: services renamed to the YAML names, Blueprint Auto Sync off, auto-deploy from git on.
  A push to `main` deploys.
- **Just shipped**: the digital redesign (glass header, tiles-only home, checkout with scenario
  sheet, inspector timeline, Back Office in plain words, settings), dark mode
  ([ADR-010](../knowledge/decisions/ADR-010-one-theme-attribute-and-token-sets.md)), redirect
  returns settled through `/result`.
- **Waiting on the owner**: check production after the deploy; confirm Drop-in in Firefox with
  Adblock Plus.
- **Next candidates** (from [current/digital-status.md](../knowledge/current/digital-status.md)):
  update `lifecycle_actions` from responses and webhooks; model refunds; a webhook.site-to-local
  relay so real notifications reach the dev server without a tunnel.

# Current work

Task state only. Durable facts belong in `knowledge/`; history belongs in `git log`.

- **Updated**: 2026-10-09
- **Focus**: `apps/adyen-digital` (owner instruction). Styling only when asked; agentic out of
  scope.
- **Blocked on the owner (Render)**: the Blueprint's first sync since the 3 August rename detached
  `adyen-digital`, `adyen-v6-styling` and `adyen-agentic-commerce` (render.yaml now names them
  `digital-checkout`, `dropin-styling`, `agentic-commerce`). Production still runs Adyen Web 6.41.0.
  Do not push until Auto Sync is off, or a sync could create three new, empty services. Then: deploy
  the latest commit on the existing services, rename them to the YAML names, sync and check the
  preview says "update", not "create".
- **Waiting on the owner**: confirm Drop-in in Firefox with Adblock Plus enabled on the dev server.
- **Next candidates** (from [current/digital-status.md](../knowledge/current/digital-status.md)):
  update `lifecycle_actions` from responses and webhooks; a webhook.site-to-local relay so real
  notifications reach the dev server without a tunnel.

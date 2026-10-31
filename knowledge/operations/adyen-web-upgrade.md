---
type: Runbook
title: "Upgrading Adyen Web"
description: "The checklist for moving @adyen/adyen-web to a new version: release notes, every import map, the Preact pin, a minimal lockfile change, the token audit, version strings, and the checks that prove it."
tags: [runbook, adyen-web, dependencies]
status: stable
scope: adyen-web-upgrade
generated:
  by: claude-code/opus-5.5
  at: 2026-10-16T14:30:00Z
sources:
  - id: root
    resource: ../../deno.json
    title: Root import map
  - id: audit
    resource: ../../apps/adyen-v6-styling/components/adyenOptions.test.ts
    title: Token audit against the real adyen.css
  - id: options
    resource: ../../apps/adyen-v6-styling/components/adyenOptions.ts
    title: ADYEN_WEB_VERSION and the token catalogue
verified:
  - at: 2026-10-09
    check: "Followed for 6.41.0 to 6.46.0: deno task check green, token audit updated (three new tokens, one changed default), Docker images built from the lock, Drop-in rendered in Firefox with an analytics block."
  - at: 2026-10-16
    check: "Followed for 6.46.0 to 6.47.0: lockfile edited by hand to the SDK and two dependencies, deno install --frozen green, token audit added animation-duration-slow, deno task check green, styling computed styles and export hash unchanged in dark mode, digital-checkout:6.47.0 built, Drop-in payments authorised on TEST."
---

# Upgrading Adyen Web

1. **Read the release notes** for every version in between
   (`gh api repos/Adyen/adyen-web/releases`). Note breaking changes and versions flagged "do not
   use" (6.45.1 was).
2. **Bump every import map**: the root `deno.json` and each `apps/*/deno.json` that lists
   `@adyen/adyen-web` ([ADR-004](../decisions/ADR-004-one-adyen-web-and-one-preact.md)).
3. **Check the Preact pin.** `jq '.dependencies' node_modules/@adyen/adyen-web/package.json` shows
   the exact `preact` Adyen Web pins. If it moved, move `preact` in every import map to the same
   version, otherwise Fresh and `@preact/signals` resolve to a second Preact.
4. **Keep the lockfile change minimal.** `deno install` after the bump. If stale peer resolutions
   remain (`*_preact@<old>` keys), edit only those entries rather than regenerating `deno.lock`,
   which would move unrelated transitive dependencies. For 6.47.0 a fresh resolution re-keyed every
   Preact entry with Preact's optional `preact-render-to-string` peer; the committed lock keeps the
   old keys and changes only the SDK's entry and its own dependencies. `deno install --frozen` must
   then succeed.
5. **Run the token audit**: `deno test -A apps/adyen-v6-styling/components/adyenOptions.test.ts`.
   Add tokens Adyen now reads, remove those it dropped, fix changed defaults, using the values in
   the new `styles/adyen.css`.
6. **Update the version strings**: `ADYEN_WEB_VERSION` in `adyenOptions.ts`, `adyenWeb` in
   `packages/platform/base-api.ts`, the footer in `packages/ui/components.tsx`, the README version
   table, the wikis. `grep -rn "<old version>"` must come back empty, bar historical notes.
7. **Prove it**: `deno task check`; restart the dev server (the dev bundle is per start); load
   Drop-in and pay once on TEST; build a Docker image.

---
type: Runbook
title: "Upgrading Adyen Web"
description: "The checklist for moving @adyen/adyen-web to a new version: release notes, every package.json pin, a minimal bun.lock change, the token audit, version strings, and the checks that prove it."
tags: [runbook, adyen-web, dependencies]
status: stable
scope: adyen-web-upgrade
generated:
  by: claude-code/opus-5.5
  at: 2026-11-25T13:00:00Z
sources:
  - id: root
    resource: ../../package.json
    title: Workspace members whose package.json pins Adyen Web
  - id: audit
    resource: ../../apps/adyen-v6-styling/src/options/css-tokens.test.ts
    title: Token audit against the real adyen.css
  - id: options
    resource: ../../apps/adyen-v6-styling/src/options/controls.ts
    title: ADYEN_WEB_VERSION (the token catalogue is src/options/css-tokens.ts)
verified:
  - at: 2026-10-16
    check: "6.46.0 to 6.47.0: hand-edited lockfile, deno install --frozen green, token audit added animation-duration-slow, deno task check green, styling computed styles and export hash unchanged, digital-checkout:6.47.0 built, Drop-in authorised on TEST."
  - at: 2026-11-15
    check: "6.47.0 to 6.48.1 with api-library 32.3.0: lockfile rebuilt keeping the old Preact keys, deno install --frozen green, token audit unchanged, deno task check green, digital-checkout:6.48.1 built, Sessions Drop-in loaded on TEST (/sessions 200). No payment submitted in this check."
---

# Upgrading Adyen Web

1. **Read the release notes** for every version in between
   (`gh api repos/Adyen/adyen-web/releases`). Note breaking changes and versions flagged "do not
   use" (6.45.1 was). The version must be at least a week old: `bunfig.toml`'s
   `minimumReleaseAge` keeps `bun install` from resolving anything newer.
2. **Bump every pin**: `@adyen/adyen-web` in `packages/ui/package.json` and in each
   `apps/*/package.json`, to the same exact version
   ([ADR-014](../decisions/ADR-014-every-playground-on-bun-and-next.md)). The hoisted linker must
   end with one copy: `ls node_modules/@adyen` shows a single `adyen-web`.
3. **Keep the lockfile change minimal.** `bun install` after the bump; `git diff bun.lock` should
   touch only the SDK and its own dependencies. Then `bun install --frozen-lockfile` must succeed.
   Adyen Web vendors its runtime Preact under `dist/es/external/`, so there is no Preact pin to
   follow any more.
4. **Run the token audit**: `bun test apps/adyen-v6-styling/src/options/css-tokens.test.ts`.
   Add tokens Adyen now reads, remove those it dropped, fix changed defaults, using the values in
   the new `styles/adyen.css`.
5. **Update the version strings**: `ADYEN_WEB_VERSION` in `src/options/controls.ts`, `adyenWeb` in
   `packages/platform/base-api.ts`, the footer in `packages/ui/components.tsx`, the README version
   table, the wikis. `git grep -n "<old version>"` must come back empty, bar historical notes.
6. **Prove it**: `bun run check`; restart `bun run dev:digital`; load Drop-in and pay once on TEST;
   build a Docker image.

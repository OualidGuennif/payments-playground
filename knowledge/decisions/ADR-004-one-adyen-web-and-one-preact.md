---
type: Decision
title: "ADR-004: One Adyen Web version and one Preact across the workspace"
description: "Every app pins the same @adyen/adyen-web and the same preact as the root import map, so the shared UI package and Fresh never load a second copy."
tags: [decision, dependencies, adyen-web, preact]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: root
    resource: deno.json
    title: Root import map
  - id: lock
    resource: deno.lock
    title: Resolved versions
  - id: upgrade
    resource: knowledge/operations/adyen-web-upgrade.md
    title: The upgrade runbook that enforces it
---

# ADR-004: One Adyen Web version and one Preact

**Context.** `packages/ui` imports `@adyen/adyen-web` through the root import map, while each app
resolves its own imports through its own `deno.json`. Two versions would load two SDKs on one page.
Adyen Web 6.46.0 also pins `preact` exactly (10.29.8), which pulled Fresh and `@preact/signals` onto
it while the apps still pinned 10.29.2: two Preacts, broken hooks.

**Decision.** `@adyen/adyen-web` and `preact` are pinned to one version, identical in the root
`deno.json` and in all four app `deno.json` files. The `preact` pin follows whatever Adyen Web pins.
The SDK version is also written in the UI footer, `/api/health` and the styling token audit.

**Consequences.** An Adyen Web bump touches every app, even when only one asked for it; follow
[the upgrade runbook](../operations/adyen-web-upgrade.md). Adyen Web's own runtime Preact is
vendored inside its `dist/es/external/` and never shares state with the app's.

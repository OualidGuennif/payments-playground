---
type: Architecture
title: "System overview: four playgrounds, two shared packages, one process each"
description: "The workspace layout, how one app is assembled from Fresh and Hono, the islands boundary, the shared packages, how the server talks to Adyen, ports, and how to add a fifth playground."
tags: [architecture, workspace, fresh, hono]
status: stable
scope: system-overview
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: architecture-doc
    resource: git-history:docs/ARCHITECTURE.md
    title: "Migrated from docs/ARCHITECTURE.md (removed in the commit that introduced this bundle)"
  - id: workspace
    resource: ../../deno.json
    title: Workspace members, pinned imports, every root task
  - id: digital-main
    resource: ../../apps/adyen-digital/main.ts
    title: How Fresh, Hono and the security middleware are wired in one app
---

# System overview

Four Adyen TEST playgrounds in one Deno workspace. They share a server library, a UI library and a
build pipeline, and each one deploys on its own. None of them is meant for production; see the
[README disclaimer](../../README.md#disclaimer).

```
payments-playground/
├── apps/
│   ├── adyen-digital/           online checkout: Sessions, Advanced, API only, MIT, Pay by Link
│   ├── adyen-ipp-endless-aisle/ in-person payments against a Cloud terminal
│   ├── adyen-agentic-commerce/  agent-initiated purchases, mock and real paths kept apart
│   ├── adyen-v6-styling/        Drop-in theming workbench (no orders, no Back Office)
│   └── landing/                 static front door linking to the four (no build, no server)
├── packages/
│   ├── platform/                server only: Adyen calls, SQLite, security, state machine
│   └── ui/                      browser-safe: Preact components, tokens, Adyen Web setup
├── tools/                       dev/build/start orchestration, Vite plugins, checks
├── knowledge/                   this bundle
├── docs/                        public SECURITY.md and KNOWN_LIMITS.md
└── render.yaml                  one Blueprint for the landing page and the four services
```

Versions are pinned once, in the root `deno.json`, and repeated verbatim in each app's `deno.json`
(see [ADR-004](../decisions/ADR-004-one-adyen-web-and-one-preact.md)).

## How one app is put together

| File / folder    | What it does                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.ts`        | Creates the Fresh app; runs optional Basic Auth first, then static files; sends `/api/*`, `/healthz` and `/webhook` to Hono; applies security headers. |
| `api.ts`         | Every API route of the app. Talks to Adyen and SQLite; nothing here reaches the browser.                                                               |
| `routes/`        | Fresh pages, server-rendered. `_app.tsx` is the shell.                                                                                                 |
| `islands/`       | Interactive parts hydrated in the browser. Adyen Web is mounted here.                                                                                  |
| `components/`    | Presentational pieces and option catalogues. No network calls.                                                                                         |
| `assets/app.css` | App CSS layered on `packages/ui/styles.css`.                                                                                                           |

**One process, two frameworks.** Fresh renders pages, Hono serves the API, both in one server: no
second runtime and no proxy hop. A page that needs API data calls the Hono app in-process (the
`[flow].tsx` handler does this for `/api/bootstrap`, forwarding the request's headers).

**Islands are the boundary that matters.** Anything under `islands/` ships to the browser. Server
secrets live behind `api.ts`. `packages/platform` is server-only, with one deliberate exception:
`markets.ts` is pure data and is imported by the digital island, so it must never import anything
server-side.

## The shared packages

- [`packages/platform`](../components/platform-package.md): Adyen client, config, profiles, SQLite,
  security middleware, HMAC, sanitising, state machine, lifecycle rules, markets.
- [`packages/ui`](../components/ui-package.md): design tokens, shell components, the fetch helper
  that adds the CSRF token, per-method Adyen Web configuration.

Put anything a second app could plausibly want in `packages/platform`, not in the app. That rule is
why markets, HMAC and the state machine each exist exactly once.

## Talking to Adyen

All server calls go through `packages/platform/adyen.ts`, over the official Adyen Node library
([ADR-002](../decisions/ADR-002-official-adyen-node-library.md)). TEST is enforced there, not by
convention ([ADR-001](../decisions/ADR-001-test-only-enforced-in-code.md)). Each Checkout endpoint
accepts a different set of fields, so request bodies are built per endpoint; the details are in
[the Checkout API notes](../references/adyen-checkout-api-notes.md).

## Ports and processes

| App     | `dev:all` / `dev:<app>` port | Notes                                                   |
| ------- | ---------------------------- | ------------------------------------------------------- |
| digital | 8001                         | `deno task dev` inside the app uses Vite's default 5173 |
| ipp     | 8002                         |                                                         |
| agentic | 8003                         |                                                         |
| styling | 8004                         |                                                         |

## Adding a fifth playground

1. Create `apps/<name>/` with the six pieces above; copy the smallest app as the skeleton.
2. Add it to `workspace` in the root `deno.json`, with `dev:` and `build:` tasks.
3. Build its API on `createPlatformContext` from `packages/platform/base-api.ts`, so it inherits
   bootstrap, profiles and health.
4. Add a service to `render.yaml`, with a disk only if it persists anything.
5. Link it from `apps/landing/index.html` and the README application table.
6. Add its SSR assertion to the `ssr:assert` task and to its Dockerfile. Renaming an app moves its
   SSR marker: each Dockerfile asserts the built page still contains the app's own name.

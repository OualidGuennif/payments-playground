---
type: Architecture
title: "System overview: three playgrounds, two shared packages, one process each"
description: "The Bun workspace, how one Next.js app is assembled with its Elysia API, the client-component boundary, the shared packages, how the server talks to Adyen, ports, and adding a playground."
tags: [architecture, workspace, nextjs, elysia]
status: stable
scope: system-overview
generated:
  by: claude-code/opus-5.5
  at: 2026-11-26T01:20:00Z
sources:
  - id: architecture-doc
    resource: git-history:docs/ARCHITECTURE.md
    title: "Migrated from docs/ARCHITECTURE.md (removed in the commit that introduced this bundle)"
  - id: workspace
    resource: ../../package.json
    title: Workspace members, exact pins, every root script
  - id: digital-main
    resource: ../../apps/adyen-digital/src/proxy.ts
    title: The digital proxy, Basic Auth and the CSRF cookie before the Next.js pages
---

# System overview

Three Adyen TEST playgrounds in one Bun workspace, each a Next.js 16 app run by Bun with one Elysia
API typed for the browser by Eden ([ADR-014](../decisions/ADR-014-every-playground-on-bun-and-next.md)).
Digital and styling share a server library and a UI library; the agentic store keeps its own
server modules ([ADR-012](../decisions/ADR-012-agentic-app-on-bun-and-next.md)). Each one deploys
on its own. None of them is meant for production; see the
[README disclaimer](../../README.md#disclaimer).

```
payments-playground/
├── apps/
│   ├── adyen-digital/           online checkout: Sessions, Advanced, API only, MIT, Pay by Link
│   ├── adyen-agentic-commerce/  a store agents shop over UCP and PAP
│   ├── adyen-v6-styling/        Drop-in theming workbench (no orders, no Back Office)
│   └── landing/                 static front door linking to the three (no build, no server)
├── packages/
│   ├── platform/                server only: Adyen calls, SQLite, security, state machine
│   └── ui/                      browser-safe: React components, tokens, Eden client, Adyen Web setup
├── testing/                     the assert helpers the bun:test suites share
├── tools/                       dev/start/verify orchestration, build checks, repository checks
├── knowledge/                   this bundle
├── docs/                        public SECURITY.md and KNOWN_LIMITS.md
└── render.yaml                  one Blueprint for the landing page and the three services
```

Versions are exact in every `package.json`; `bunfig.toml` hoists one copy of each into the root
`node_modules`, refuses versions published in the last week (`minimumReleaseAge`), and `bun.lock`
is the one lockfile. The root `overrides` raises one transitive package past a vulnerable pin
(`@modelcontextprotocol/client`, under Flue: [ADR-018](../decisions/ADR-018-ask-agent-flue-in-process.md)).

## How one app is put together

| File / folder                      | What it does                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/proxy.ts`                     | Next's proxy: optional Basic Auth, then the CSRF cookie on page responses. Reads no config.      |
| `src/server/api.ts`                | The Elysia app; exports `App` and `handle`. Digital composes it from one plugin per flow in `src/server/routes/`, with request bodies, order recording and webhook reading in `src/server/*.ts`. |
| `src/app/api/[[...slugs]]/route.ts` | Hands `/api/*` to `handle` (`serveSecurely`: Basic Auth, rate limit, CSRF, session, headers).   |
| `src/app/healthz`, `src/app/webhook` | Route handlers for the paths outside `/api`.                                                   |
| `src/app/**/page.tsx`              | Pages, server-rendered; `layout.tsx` is the shell with the theme script and stylesheets.         |
| `src/components/`                  | Client components (`"use client"`), where Adyen Web is mounted, and presentational pieces.       |
| `next.config.ts`                   | Standalone output traced from the repository root, security headers, tracing excludes.           |

**One process.** Next renders the pages and its route handlers serve the Elysia API in the same Bun
process: no second runtime and no proxy hop. A page that needs API data calls the Elysia app
in-process (`bootstrapFor` in digital's `[flow]` page, forwarding the request's headers).

**Client components are the boundary that matters.** Anything a `"use client"` module imports ships
to the browser. Server secrets live behind `src/server/`. `packages/platform` is server-only,
with one deliberate exception: `markets.ts` is pure data and is imported by the digital workbench,
so it must never import anything server-side.

## The shared packages

- [`packages/platform`](../components/platform-package.md): Adyen client, config, profiles, SQLite,
  the Elysia base API and its security wrapper, HMAC, sanitising, state machine, lifecycle rules,
  markets.
- [`packages/ui`](../components/ui-package.md): design tokens, shell components, the Eden client
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

| App     | `dev:all` / `dev:<app>` port | Notes                                                 |
| ------- | ---------------------------- | ----------------------------------------------------- |
| digital | 8001                         | Next on Bun via `tools/dev/bun-app.ts`, reads `PORT`  |
| agentic | 8003                         | same                                                  |
| styling | 8004                         | same                                                  |

## Adding a playground

1. Create `apps/<name>/` with the pieces above; copy the smallest app (styling) as the skeleton.
2. Add it to `workspaces` in the root `package.json`, with `dev:`, `build:` and `types` entries,
   and its `package.json` to the manifest copies of every Dockerfile.
3. Build its API on `createPlatformApi(createPlatformContext(...))` from
   `packages/platform/base-api.ts`, so it inherits bootstrap, profiles and health.
4. Add a service to `render.yaml`, with a disk only if it persists anything.
5. Link it from `apps/landing/index.html` and the README application table.
6. Add its SSR assertion to the `ssr:assert` script and to its Dockerfile. Renaming an app moves its
   SSR marker: each Dockerfile asserts the built page still contains the app's own name.

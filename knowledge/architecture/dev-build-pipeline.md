---
type: Architecture
title: "Dev and build pipeline: Next.js 16 with Turbopack on Bun"
description: "How each app runs in dev and builds: Bun runs Next with the env already loaded, Turbopack bundles the workspace, standalone output traced from the root, and the facts that shaped next.config.ts."
tags: [architecture, dev, build, nextjs, turbopack]
status: stable
scope: dev-build-pipeline
generated:
  by: claude-code/opus-5.5
  at: 2026-11-15T21:00:00Z
sources:
  - id: next-config
    resource: ../../apps/adyen-digital/next.config.ts
    title: "The digital app's Next.js configuration (styling's and agentic's follow it)"
  - id: bun-app
    resource: ../../tools/dev/bun-app.ts
    title: Runs a package script with the app's .env loaded without $ expansion
  - id: config
    resource: ../../packages/platform/config.ts
    title: "Working-directory paths marked turbopackIgnore"
  - id: standalone
    resource: ../../tools/build/standalone.ts
    title: Starts a standalone server for the build checks
  - id: vite-era
    resource: git-history:apps/adyen-digital/vite.config.ts
    title: "The Vite and Fresh configuration this replaced on 2026-11-15"
---

# Dev and build pipeline

Each app is Next.js 16.4.3 run by Bun (`bun --bun next dev|build|start`), so server code has
`bun:sqlite` and Bun's APIs. `bun run dev:<app>` goes through `tools/dev/bun-app.ts`, which reads
the app's `.env` with `packages/platform/dotenv.ts` and sets `__NEXT_PROCESSED_ENV=true`: Next's
own loader expands `$name` inside values and once cut an Adyen key that contained `$`.
([ADR-014](../decisions/ADR-014-every-playground-on-bun-and-next.md))

## Facts that shaped the configuration

- **One root for tracing and bundling.** `outputFileTracingRoot` and `turbopack.root` point at the
  repository root, where the hoisted `node_modules` and `packages/` live; `transpilePackages`
  compiles `@suite/platform` and `@suite/ui` from source.
- **`@adyen/api-library` stays external** (`serverExternalPackages`): bundled, its CommonJS chain
  breaks. `packages/platform/adyen.ts` loads it lazily and accepts both interop shapes.
- **Working-directory paths carry `/* turbopackIgnore: true */`** in `packages/platform/config.ts`.
  Without it Turbopack traced `data/<app>.sqlite` from `join(process.cwd(), "data", ...)`, watched
  it, and every request that wrote the database triggered a recompile and a page refresh: on
  2026-11-15 the Sessions page re-created a session in a loop and Drop-in never mounted.
- **`outputFileTracingExcludes`** keeps `data/`, SQLite files and `.env*` out of the standalone
  trace (ADR-009). Next itself still copies a loaded `.env` into `.next/standalone`; images never
  see one because the build context excludes it.
- **The proxy reads no config.** Next copies every file the proxy's imports touch into the build,
  and tracing excludes do not apply to it; `src/proxy.ts` only checks Basic Auth and issues the
  CSRF cookie.
- **Client-only workbench.** Digital's checkout workbench takes its first market from the browser,
  so it renders through `next/dynamic` with `ssr: false` to avoid a hydration mismatch.
- **Adyen Web in dev** arrives inside Turbopack chunks (`node_modules_@adyen_adyen-web_dist_es_*`);
  no chunk URL contains "analytics", so the Vite-era dev bundle
  ([ADR-006](../decisions/ADR-006-adyen-web-one-bundle-in-dev.md)) is not needed.
- **`agentRules: false`**: Next 16.4 otherwise writes an `AGENTS.md` into each app.

## Dev server caveats

React's strict mode runs effects twice in dev, so the Sessions page creates two Adyen sessions per
load in dev only. Restart `bun run dev:<app>` after changing `next.config.ts`, `.env` or a
dependency; pages, components and `src/server/api.ts` reload on their own.

## Production build

`bun run build:<app>` runs `next build` into `.next/standalone/<app path>/server.js` plus
`.next/static`. `bun run ssr:assert` boots each standalone server on a `:memory:` database and checks
the home page answers 200 with a `<main>`, the TEST marker and the app's name
(`tools/build/assert-built-ssr.ts`); each Dockerfile runs the same assertion in its build stage.
`bun run verify` starts all three standalone servers and checks `/healthz` and every listed page.

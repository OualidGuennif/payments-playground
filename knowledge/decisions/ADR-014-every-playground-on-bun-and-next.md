---
type: Decision
title: "ADR-014: Every playground on Bun, Next.js, Elysia and Eden"
description: "Deno, Fresh, Hono, Preact and Vite leave the repository: one Bun workspace, Next.js 16 pages, one Elysia API per app behind a route handler, Eden in the browser, one hoisted Adyen Web and React."
tags: [decision, bun, nextjs, elysia, eden, workspace]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-16T00:30:00Z
sources:
  - id: workspace
    resource: ../../package.json
    title: Workspace members, exact pins, every root script
  - id: bunfig
    resource: ../../bunfig.toml
    title: The hoisted linker and exact installs
  - id: lock
    resource: ../../bun.lock
    title: The one lockfile
  - id: digital-api
    resource: ../../apps/adyen-digital/src/server/api.ts
    title: One Elysia chain exporting its App type
  - id: config
    resource: ../../packages/platform/config.ts
    title: "Paths built from the working directory, marked turbopackIgnore"
---

# ADR-014: Every playground on Bun, Next.js, Elysia and Eden

**Context.** On 2026-11-15 the owner asked to drop Deno and Fresh everywhere and to align every
playground on the stack the agentic store already used
([ADR-012](ADR-012-agentic-app-on-bun-and-next.md)): Bun inside Next.js, an Elysia API, Eden in
the browser. Two toolchains, two lockfiles and two UI libraries (Preact for Fresh, React for Next)
had to be kept in step by hand.

**Decision.**

- One Bun workspace (root `package.json`, `bunfig.toml` with `linker = "hoisted"` and
  `exact = true`, one `bun.lock`): `packages/platform`, `packages/ui` and the three apps.
- Every app is Next.js 16 run by Bun (`bun --bun next ...`), with `output: "standalone"`,
  `outputFileTracingRoot` and `turbopack.root` at the repository root, and `agentRules: false`.
- Each app's API is one Elysia chain served by `src/app/api/[[...slugs]]/route.ts` (plus `/healthz`
  and `/webhook` handlers where the app has them); it exports its `App` type and every browser call
  goes through Eden (`apiClient<App>`, `parseDate: false`).
- One Adyen Web and one React: each app pins the same exact versions and the hoisted linker
  resolves them to one copy. This replaces the import-map rule of
  [ADR-004](ADR-004-one-adyen-web-and-one-preact.md).
- Next's dev server bundles `@adyen/adyen-web` into Turbopack chunks, so the dev-only Vite plugin of
  [ADR-006](ADR-006-adyen-web-one-bundle-in-dev.md) is gone with Vite.
- Server paths built from `process.cwd()` carry `/* turbopackIgnore: true */`: Turbopack otherwise
  traces the data folder, watches it, and refreshes every open dev page on each database write.

**Consequences.** `deno fmt` and `deno lint` left with Deno; `bun run check` covers knowledge, links,
repository health, Biome, `tsc` per package and app, `bun test`, the three builds, an SSR assertion
on each standalone server and the template suites. Biome 2.6.7 (owner's yes, 2026-11-15) replaces
`deno fmt` and `deno lint` with the same style; Markdown stays unformatted because Biome's Markdown
formatter rewrites YAML frontmatter. Docker images build inside the workspace on `oven/bun:1.4.4` and run
`bun apps/<app>/server.js` as uid 1993. The required CI check "Deno check" became "Bun check".

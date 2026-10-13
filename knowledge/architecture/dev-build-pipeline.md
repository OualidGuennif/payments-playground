---
type: Architecture
title: "Dev and build pipeline: Vite, Fresh's plugin, the Deno loader, and the local plugins"
description: "How Vite resolves modules through Deno, why npm packages reach the dev browser unbundled, what each plugin in scripts/ fixes, the SSR hot-reload caveat, and what a production build emits."
tags: [architecture, vite, fresh, deno, build]
status: stable
scope: dev-build-pipeline
generated:
  by: claude-code/opus-5.5
  at: 2026-10-13T06:30:00Z
sources:
  - id: vite-config
    resource: apps/adyen-digital/vite.config.ts
    title: The digital app's Vite configuration (styling's is the same, without devClientAddress)
  - id: dev-bundle
    resource: scripts/adyen-web-dev-bundle.ts
    title: Adyen Web served as one bundle in dev
  - id: library-external
    resource: scripts/adyen-library-external.ts
    title: Adyen Node library kept external in the server build
  - id: sqlite-hotfix
    resource: scripts/sqlite-vite-hotfix.ts
    title: SQLite FFI import.meta.url rewrite
  - id: client-address
    resource: scripts/dev-client-address.ts
    title: X-Forwarded-For from the socket in dev, for shopperIP
  - id: fresh-plugin
    resource: https://jsr.io/@fresh/plugin-vite/1.1.2/src/mod.ts
    title: "@fresh/plugin-vite 1.1.2: optimizeDeps.noDiscovery and the build environments"
---

# Dev and build pipeline

Each app builds with Vite 7.1.4 and `@fresh/plugin-vite` 1.1.2. The plugin brings the Deno loader
(`@deno/loader`), which resolves every import through the workspace import maps with
`enforce: "pre"`. It first asks the other plugins via `this.resolve` but ignores an answer from
Vite's own `vite:resolve`, and passes any `\0`-prefixed id through untouched.

## Facts that shaped the configuration

- **No dependency pre-bundling in dev.** Fresh sets `optimizeDeps.noDiscovery: true`, so an npm
  package reaches the dev browser as its raw source modules, at their real
  `/@fs/.../node_modules/.deno/...` paths. Turning the optimizer back on, even for one package,
  makes Vite append `?v=` hashes to every node_modules import, which the Deno loader cannot open
  (ENOENT on `preact/debug`).
- **Adyen Web is therefore served as one esbuild bundle in dev** by `adyenWebDevBundle`, at
  `/@id/__x00__adyen-web-dev-bundle`. Its ~620 modules include `core/Analytics/*.js`, which Adblock
  Plus, uBlock Origin and Firefox's tracking protection block; one blocked module failed the whole
  graph and Drop-in never mounted ([ADR-006](../decisions/ADR-006-adyen-web-one-bundle-in-dev.md)).
  The bundle is built once per server start: restart the dev server after an Adyen Web version
  change.
- **`adyenLibraryExternal` (build only, server environment)** keeps `@adyen/api-library` external.
  Bundled, its CommonJS chain lost `debug`'s callable default export and the built server died on
  import with `debug_1.default is not a function`.
- **`sqliteViteHotfix`** replaces `import.meta.url` in the SQLite FFI module with its URL literal;
  the Deno bridge and Vite's SSR transform otherwise both rewrite it and Vite throws.
- **`devClientAddress` (digital, dev only)** sets `X-Forwarded-For` from the socket. Fresh's dev
  server calls the app with a stub connection (`remoteAddr.hostname: "localhost"`), so without it
  `/payments` had no `shopperIP` locally. Fresh rebuilds the `Request` from `rawHeaders`, which
  under Deno is a getter returning a copy: a `push` is lost, the property is redefined instead.
- **`server.fs.allow: ["../.."]`**: with no root `package.json`, Vite cannot find the monorepo's
  `node_modules`, and deep imports outside the default allow-list 403 silently.

## SSR hot-reload caveat

Editing a module under `packages/platform` can leave the dev server's SSR graph half-updated: the
app's `api.ts` reloads but an import it uses does not, and requests fail with
`(0, __vite_ssr_import_N__.x) is not a function`. Restart the dev server (touching `vite.config.ts`
is enough; Vite restarts on a config change).

## Production build

`deno task build:<app>` builds the client first (`_fresh/client/assets/`, hashed chunks such as
`fresh-island__FlowWorkbench-<hash>.js`, with Adyen Web inside) and then the server
(`_fresh/server/server-entry.mjs`). `scripts/assert-built-ssr.ts` boots the built server and checks
the page renders and still names the app. The dev-only plugins have `apply: "serve"` and never touch
a build.

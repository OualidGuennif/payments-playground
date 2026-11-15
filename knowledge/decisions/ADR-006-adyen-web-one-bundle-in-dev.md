---
type: Decision
title: "ADR-006: Adyen Web is served as one bundle in dev too"
description: "A dev-only Vite plugin serves @adyen/adyen-web as a single esbuild bundle, because its ~620 unbundled modules include core/Analytics paths that ad blockers block."
tags: [decision, dev, vite, adyen-web]
status: deprecated
superseded_by: ADR-014-every-playground-on-bun-and-next.md
generated:
  by: claude-code/opus-5.5
  at: 2026-11-15T21:00:00Z
sources:
  - id: plugin
    resource: git-history:tools/dev/adyen-web-dev-bundle.ts
    title: adyenWebDevBundle, removed with Vite on 2026-11-15
  - id: config
    resource: ../../apps/adyen-digital/next.config.ts
    title: Digital's Next.js configuration, which no longer loads the plugin
---

# ADR-006: Adyen Web is served as one bundle in dev too

Superseded on 2026-11-15 by [ADR-014](ADR-014-every-playground-on-bun-and-next.md): Vite and this
plugin are gone. Next's dev server puts Adyen Web inside Turbopack chunks; on 2026-11-15 no local
chunk URL of the digital Sessions page contained "analytics" (checked without an ad blocker).

**Context.** On 2026-10-09 Drop-in did not load in Firefox with Adblock Plus on the dev server, and
did in production. The HAR showed four `core/Analytics/*.js` modules never sent (status 0). Fresh
disables Vite's dependency optimizer, so dev served the SDK as raw modules at their real paths; one
blocked module fails the whole import graph. Production bundles the SDK into a hashed chunk.
Re-enabling the optimizer for the package breaks the Deno loader (`?v=` hashes).

**Decision.** `adyenWebDevBundle` (`apply: "serve"`, client environment, `enforce: "pre"`) resolves
`@adyen/adyen-web` to a `\0` virtual module whose content is one esbuild bundle of the package.
Builds are untouched.

**Consequences.** Dev now matches production in shape: one file, no analytics path. Verified in
headless Firefox with an `analytics` request block. The bundle is built once per server start. Wired
into digital and styling (styling verified on 2026-10-09: same methods, secured fields, theme
presets and export as before, production build byte-identical); agentic does not use it.

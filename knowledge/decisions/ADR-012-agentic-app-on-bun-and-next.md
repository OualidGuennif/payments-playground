---
type: Decision
title: "ADR-012: The agentic app runs on Bun with Next.js, Elysia and Eden"
description: "apps/adyen-agentic-commerce leaves the Deno workspace: one Bun app with Next.js 16 pages and an Elysia API mounted in a catch-all route handler, typed for the browser by Eden."
tags: [decision, agentic, bun, nextjs, elysia]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-15T21:00:00Z
sources:
  - id: app
    resource: ../../apps/adyen-agentic-commerce
    title: The Bun app
  - id: package
    resource: ../../apps/adyen-agentic-commerce/package.json
    title: Exact pins and scripts
---

# ADR-012: The agentic app runs on Bun with Next.js, Elysia and Eden

**Context.** The owner wants a store that any AI agent can shop on, with PAP 1.0, UCP 2026-08-25 and
a real Adyen TEST payment, shown to merchants (2026-11-15). The owner rejected Sylius (a PHP stack
outside the repo's checks) and chose Bun + Elysia + Eden + Next.js for this app instead of Fresh.

**Decision.**

- `apps/adyen-agentic-commerce` is a Bun project (`package.json`, `bun.lock`), not a Deno workspace
  member. Next.js 16 runs under Bun (`bun --bun next ...`), so `bun:sqlite` is available.
- One Elysia instance is mounted at `src/app/api/[[...slugs]]/route.ts` (`app.fetch`, prefix
  `/api`). `next.config.ts` rewrites the protocol paths (`/.well-known/*`, `/mcp`, `/ucp/v1/*`,
  `/oauth/*`, `/healthz`) onto it. Client components call it through an Eden treaty typed from the
  server's `App` type.
- Adyen versions follow the rest of the repo (Adyen Web 6.48.1, `@adyen/api-library` 32.3.0).
- The root `deno task check` runs the app's own `bun run check`; Deno's fmt, lint, types and tests
  skip the folder.
- The Render service keeps its name, path and domain; only its Dockerfile changes (`oven/bun`).

**Consequences.** The shared `packages/platform` and `packages/ui` (Deno, Preact) are not imported
here; the TEST-only rule, HMAC check and order-state rules are reimplemented and tested in the app.
Two toolchains run in CI.

**Amended 2026-11-15.** [ADR-014](ADR-014-every-playground-on-bun-and-next.md) moved every other
app to the same stack: the store is now a member of the one Bun workspace (root `bun.lock`, its
own lock removed), its standalone server sits at `apps/adyen-agentic-commerce/server.js` in the
image, its route files re-export the Elysia handler instead of rewrites, and CI runs one toolchain.

**Amended 2026-11-17.** [ADR-015](ADR-015-customer-accounts-and-agent-network-tokens.md) adds
customer passkeys: the store pins `@simplewebauthn/server` 14.1.0 and `@simplewebauthn/browser`
14.0.0 exactly, like its other dependencies.

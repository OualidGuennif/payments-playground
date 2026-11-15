---
type: Runbook
title: "Build and test"
description: "The root scripts, what bun run check runs and in which order, which tests reach the network, and the Bun version involved."
tags: [runbook, build, test]
status: stable
scope: build-and-test
generated:
  by: aeion-adoption/1.0
  at: 2026-11-15T21:00:00Z
sources:
  - id: tasks
    resource: ../../package.json
    title: Root scripts
  - id: dockerfile
    resource: ../../apps/adyen-digital/Dockerfile
    title: The runtime image and its build-time SSR assertion
  - resource: ../../tools/build/assert-built-ssr.ts
    title: Boots one standalone server and checks its home page
  - resource: ../../tools/build/standalone.ts
    title: Starts a standalone server and checks a page, for the build checks
  - resource: ../../tools/dev/run-all.ts
    title: dev:all and start:all
  - resource: ../../tools/dev/verify.ts
    title: Starts every standalone build and checks health and pages
  - resource: ../../tools/dev/migrate-legacy-env.ts
    title: Writes each app's .env from the legacy playground's
  - resource: ../../tools/knowledge/knowledge-check.ts
    title: The knowledge checker, on Bun
  - resource: ../../.claude/hooks/project_files.py
    title: The file enumeration shared with doc-links and repo-health
  - resource: ../../tools/dev/bun-app.ts
    title: "The Bun app runner that loads its env file without $ expansion"
  - resource: ../../testing/assert.ts
    title: "The @std/assert subset the bun:test suites import"
  - resource: ../../tools/template-tests
    title: The template test runner
  - resource: ../../tools/knowledge/orphans
    title: Docs nothing links to
  - resource: ../../tools/knowledge/stale
    title: Docs past their review date
  - resource: ../../tools/git-hooks/pre-commit
    title: The commit gate
  - resource: ../../.claude/hooks/after-edit.py
    title: Edit feedback after every write
  - resource: ../../.claude/hooks/session-start.py
    title: The session start context
  - resource: ../../.claude/hooks/sign-off.py
    title: The stop-time sign-off
---

# Build and test

```bash
bun install                # once, and after a lockfile change
bun run check              # everything below, in order, stops at the first failure
bun run test               # packages, digital, styling and tools tests, then the agentic store's
bun run knowledge:check    # this bundle, AGENTS.md and CLAUDE.md
bun run docs:links         # knowledge sources and Spec: pointers, both ways
bun run repo:health        # size, comment and top-level-folder caps
bun run template:test      # the template suites (hooks, context, links, loops)
bun run build              # the three Next.js standalone builds
bun run ssr:assert         # each standalone server renders its home page as a TEST page
bun run verify             # build, then start the standalone servers and check /healthz and pages
```

`check` runs: `knowledge:check`, `docs:links`, `repo:health`, `types` (`tsc -p .` over packages,
testing and tools, then each app's `tsc --noEmit`), `test`, `build`, `ssr:assert`, `template:test`.
It is the local gate; run it before every push. CI repeats it on pull requests and `main` after
`bun install --frozen-lockfile`. No formatter or linter runs since `deno fmt` and `deno lint` left
with Deno on 2026-11-15; adding one needs the owner's yes.

`dev:<app>` and `dev:all` start Next through `tools/dev/bun-app.ts`, which parses the app's env file
with the platform's dotenv reader and marks it loaded for Next: Next's own loader expands `$name`
inside values, which cut an Adyen key containing `$` and gave 401s. `start:all` does the same with
`next start` on the last build. The agentic store's `bun test` preload sets fixed settings and a fake
Adyen client. Suites import `testing/assert.ts`, a small `@std/assert`-shaped helper on `bun:test`.

Per app: `bun run --cwd apps/<app> <dev|build|start|test|typecheck>`.

Bun 1.4.4 (`oven/bun:1.4.4` in the images, `bun-version: 1.4.4` in CI) and Python 3.12+ (excluding
3.14.1) are required; `bun.lock` is the source of truth for dependency versions; see
[the upgrade runbook](adyen-web-upgrade.md) before touching it.

## Tests that reach the network

`apps/adyen-v6-styling/src/components/adyenOptions.test.ts` fetches the real `adyen.css` for the
pinned Adyen Web version from Adyen's CDN and fails if the styling panel offers a token Adyen no
longer reads, misses a new one, or shows a wrong default. Offline it fails on the fetch, not on a
regression. Every other test is offline; Adyen calls are tested with a replaced transport.

## The release check

A Docker build is the closest thing to production locally: it installs from the lock in a clean
tree, type-checks, builds, and runs the app's SSR assertion on the standalone server
([Docker and Render](docker-and-render.md)).

---
type: Runbook
title: "Build and test"
description: "The root tasks, what deno task check runs and in which order, which tests reach the network, and the Deno versions involved."
tags: [runbook, build, test]
status: stable
scope: build-and-test
generated:
  by: aeion-adoption/1.0
  at: 2026-11-15T18:00:00Z
sources:
  - id: tasks
    resource: ../../deno.json
    title: Root tasks
  - id: dockerfile
    resource: ../../apps/adyen-digital/Dockerfile
    title: The runtime image and its build-time SSR assertion
  - resource: ../../.claude/hooks/project_files.py
    title: The file enumeration shared with doc-links and repo-health
  - resource: ../../tools/dev/bun-app.ts
    title: "The Bun app runner that loads its env file with @std/dotenv"
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
deno task check            # everything below, in order, stops at the first failure
deno task test             # packages, apps and tools tests, sequentially
deno task knowledge:check  # this bundle, AGENTS.md and CLAUDE.md
deno task docs:links       # knowledge sources and Spec: pointers, both ways
deno task repo:health      # size, comment and top-level-folder caps
deno task template:test    # the template suites (hooks, context, links, loops)
deno task build            # the four production builds
deno task verify           # build, then start the builds and check /healthz
```

`check` runs: `fmt:check`, `lint`, `knowledge:check`, `docs:links`, `repo:health`, `types`
(`deno check` on every package, Deno app and tool), `test`, `check:agentic`, `build`, `ssr:assert`,
`template:test`. It is the local gate; run it before every push. CI repeats the whole set on pull
requests and `main`.

`apps/adyen-agentic-commerce` is a Bun project outside the Deno workspace (root `deno.json`
`exclude`), so Deno's fmt, lint, types and tests skip it. `check:agentic` runs
`bun install --frozen-lockfile`, `tsc --noEmit` and `bun test` there, and `build:agentic` runs
`next build` under Bun; both need Bun on the path. `dev:agentic` starts it through
`tools/dev/bun-app.ts`, which parses the app's env file with `@std/dotenv` like the Deno apps and
marks it loaded for Next: Next's own loader expands `$name` inside values, which cut an Adyen key
containing `$` and gave 401s. Its `bun test` preload sets fixed settings and a fake Adyen client.

Per app: `deno task --cwd apps/adyen-digital <dev|build|test|start>`; `start` serves the last build.
The suites run sequentially: the SQLite native library downloads on first use, and parallel workers
raced that download on the CI runner.

Python 3.12+ (excluding 3.14.1) and Node 18+ are required for the checks and adapters; the apps
themselves stay on Deno 2.9.4.

## Tests that reach the network

`apps/adyen-v6-styling/components/adyenOptions.test.ts` fetches the real `adyen.css` for the pinned
Adyen Web version from Adyen's CDN and fails if the styling panel offers a token Adyen no longer
reads, misses a new one, or shows a wrong default. Offline it fails on the fetch, not on a
regression. Every other test is offline; Adyen calls are tested with a replaced transport.

## Deno versions

Docker images and Render use `denoland/deno:2.9.4`. A local Deno as old as 2.5.6 still runs
everything (the `adyen.ts` workarounds exist for that). `deno.lock` is the source of truth for
dependency versions; see [the upgrade runbook](adyen-web-upgrade.md) before touching it.

## The release check

A Docker build is the closest thing to production locally: it installs from the lock in a clean
tree, builds, and runs the app's SSR assertion ([Docker and Render](docker-and-render.md)).

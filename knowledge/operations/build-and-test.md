---
type: Runbook
title: "Build and test"
description: "The root tasks, what deno task check runs and in which order, which tests reach the network, and the Deno versions involved."
tags: [runbook, build, test]
status: stable
scope: build-and-test
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - id: tasks
    resource: ../../deno.json
    title: Root tasks
  - id: dockerfile
    resource: ../../apps/adyen-digital/Dockerfile
    title: The runtime image and its build-time SSR assertion
  - resource: ../../.claude/hooks/project_files.py
    title: The file enumeration shared with doc-links and repo-health
  - resource: ../../tools/efficiency/bundle
    title: The guide bundle builder
  - resource: ../../tools/factory-tests
    title: The factory test runner
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
deno task test             # packages, apps and tools tests, in parallel
deno task knowledge:check  # this bundle, AGENTS.md and CLAUDE.md
deno task docs:links       # knowledge sources and Spec: pointers, both ways
deno task repo:health      # size, comment and top-level-folder caps
deno task factory:test     # the adapted factory checks
deno task build            # the four production builds
deno task verify           # build, then start the builds and check /healthz
```

`check` runs: `fmt:check`, `lint`, `knowledge:check`, `types` (`deno check` on every package, app
and tool), `test`, `build`, `ssr:assert`. It is the local gate; run it before every push. The
factory checks (`docs:links`, `repo:health`, `factory:test`) run beside it. CI repeats the whole set
on pull requests and `main`.

Per app: `deno task --cwd apps/adyen-digital <dev|build|test|start>`; `start` serves the last build.

## The analysis baseline

`deno task arch:setup` installs the pinned Graphify 0.9.97 and Archify v3.2.0 into the ignored
`.aeion/integrations/`. `deno task arch:refresh` builds and verifies the exact-HEAD graph and the
three diagrams; a PASS receipt is `.aeion/analysis/<sha>/receipt.json`. CI runs the same refresh on
`main` and pull requests. The working graph for `tools/architecture/ask` rebuilds on demand.

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

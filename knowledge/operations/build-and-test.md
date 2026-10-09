---
type: Runbook
title: "Build and test"
description: "The root tasks, what deno task check runs and in which order, which tests reach the network, and the Deno versions involved."
tags: [runbook, build, test]
status: stable
scope: build-and-test
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: tasks
    resource: deno.json
    title: Root tasks
  - id: dockerfile
    resource: apps/adyen-digital/Dockerfile
    title: The runtime image and its build-time SSR assertion
---

# Build and test

```bash
deno task check            # everything below, in order, stops at the first failure
deno task test             # packages, apps and scripts tests, in parallel
deno task knowledge:check  # this bundle, AGENTS.md and CLAUDE.md
deno task build            # the four production builds
deno task verify           # build, then start the builds and check /healthz
```

`check` runs: `fmt:check`, `lint`, `knowledge:check`, `types` (`deno check` on every package, app
and script), `test`, `build`, `ssr:assert`. It is the only gate: there is no CI workflow in this
repository, so run it before every push.

Per app: `deno task --cwd apps/adyen-digital <dev|build|test|start>`; `start` serves the last build.

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

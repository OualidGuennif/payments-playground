---
type: Decision
title: "ADR-011: Adopt Æion Factory v1.7.0"
description: "Adopt the factory repository and agent architecture while keeping the four apps, TEST-only rules, Render root and public docs as they are."
status: stable
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - resource: ../../AGENTS.md
    title: "The merged project and agent rules"
  - resource: ../../render.yaml
    title: "The root deployment blueprint that must not move"
  - resource: ../../deno.json
    title: "Root tasks, workspace and formatting scope"
  - resource: ../../tools/architecture/integrations.json
    title: "Pinned Graphify and Archify revisions and analysis scope"
---

# ADR-011: Adopt Æion Factory v1.7.0

## Context

The repository already had a short `AGENTS.md`, an OKF v0.2 knowledge bundle, a `work/current.md`
and four Deno apps, but no shared skills, harness hooks, CI, git gates, release flow or source
analysis. Æion Factory v1.7.0 provides those as a template. The project's own instructions,
TEST-only rules, app behaviour, Adyen versions and Render Blueprint predate the template and remain
authoritative.

## Decision

Adopt the factory's phase 1–7 structure in this repository, merged with what already exists:

- one nine-folder layout: `apps/`, `packages/`, `docs/`, `knowledge/`, `work/`, `tools/`,
  `efficiency/`, `tech-watch/`, `loops/`;
- `tools/` as the one home for scripts and checks, with the project's dev/build scripts moved under
  `tools/dev` and `tools/build`;
- the 16 maintained skills, the harness adapters, the shared hooks and the 250k/300k checkpoint;
- Graphify 0.9.97 and Archify v3.2.0 installed only under the ignored `.aeion/`, with an
  exact-commit PASS receipt;
- git hooks, `develop → main` delivery and a versioned release flow, with Render still deploying
  `main` from the root `render.yaml`;
- the factory's 525-folder passive skill pool and `demo/` are omitted; the maintained skills are the
  reviewed procedures.

## Consequences

- The app code and all four Render services are unchanged; the first deploy after adoption is the
  same kind of Docker build as before.
- Checks now need Python 3.12+ (excluding 3.14.1) and Node 18+ beside Deno 2.9.4.
- `docs/SECURITY.md` and `docs/KNOWN_LIMITS.md` stay public; the internal security policy links to
  them.
- The two legacy islands above 1,500 lines must be split before `repo-health` can pass.
- The factory's upstream files are excluded from Deno fmt/lint so they stay diffable against v1.7.0.

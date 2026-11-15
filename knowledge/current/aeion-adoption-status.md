---
type: Current State
title: "Æion Factory adoption: verified state"
description: "What the adoption itself verified on 2026-10-31: checks, factory suites, analysis receipt, island sizes and the untouched Render root."
status: stable
stale_after: 2026-12-31
generated:
  by: aeion-adoption/1.0
  at: 2026-11-15T18:00:00Z
sources:
  - resource: ../../AGENTS.md
    title: "The merged agent rules and repository map"
  - resource: ../../deno.json
    title: "The complete check task"
  - resource: ../../.aeion-template
    title: "The template release this project follows"
  - resource: ../../render.yaml
    title: "The root deployment blueprint"
---

# Æion Factory adoption: verified state

Adopted from tag `v1.7.0` (commit `a2dc66e`) on 2026-10-31. Code, tests and builds only; no
production or Adyen TEST call was made by the adoption itself.

## Verified on 2026-10-31

| Check                           | Evidence                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno task check`               | fmt, lint, knowledge, links, health, types, 91 tests, four builds and SSR asserts pass                                                                               |
| `tools/factory-tests`           | doc-links 45, knowledge 11, hooks 574, context, health, pre-push, release, architecture 37, agents, loops pass                                                       |
| `tools/repo-health/repo-health` | AGENTS 108 lines, 9 folders, 0 files over 1,500, 0 comment blocks over 20                                                                                            |
| `tools/knowledge/doc-links`     | 201 links, both directions                                                                                                                                           |
| Graphify/Archify                | PASS receipt for the exact HEAD, three diagrams and the artifact hashes                                                                                              |
| Island split                    | `FlowWorkbench` 1,340 lines; `StylingPlayground` 799 lines                                                                                                           |
| Docker                          | four images built from the root context with the pinned Deno 2.9.4 image; the shared entrypoint drops to uid 1993                                                    |
| `deno task verify`              | four apps: `/healthz` plus 18 rendered pages                                                                                                                         |
| Render                          | root `render.yaml` and its five services unchanged; `main` `7b72543` is live, the four `/healthz` and the landing answer 200, and the logs show no permission errors |

## Changed since

- 2026-11-15: AGENTS.md and the root `deno.json` name Adyen Web 6.48.1 and `@adyen/api-library`
  32.3.0. The root `deno.json` drops `apps/adyen-agentic-commerce` from the workspace (it is a Bun
  app now) and adds `check:agentic` to `check`. The table above is the 2026-10-31 state and was not
  re-run for these changes.
- 2026-11-15: updated to Æion Template v4.0.3 (`.aeion-template`). Graphify, Archify, their receipt
  and `efficiency/` are gone, so the Graphify/Archify row above no longer applies;
  `tools/template-tests` replaces `tools/factory-tests`; the context rule is 340k/390k; the doc gate
  runs in `enforce` and framework mode is off (no address set).

## Open

- Owner opens one real browser flow against the live services.
- Re-verify this page before 2026-12-31 or mark it STALE.

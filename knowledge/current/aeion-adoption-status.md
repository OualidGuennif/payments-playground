---
type: Current State
title: "Æion Factory adoption: verified state"
description: "What the adoption itself verified on 2026-10-31: checks, factory suites, analysis receipt, island sizes and the untouched Render root."
status: stable
stale_after: 2026-12-31
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31T19:05:00Z
sources:
  - resource: ../../AGENTS.md
    title: "The merged agent rules and repository map"
  - resource: ../../deno.json
    title: "The complete check task"
  - resource: ../../tools/architecture/integrations.json
    title: "Pinned analysis revisions"
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

## Open

- Owner opens one real browser flow against the live services.
- Re-verify this page before 2026-12-31 or mark it STALE.

---
type: Reference
title: "Æion Template v4.0.3: upstream and local adaptations"
description: "The template release this repository follows, how it got there from Æion Factory v1.7.0, what was kept, what was omitted and where the local adaptations live."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-15T18:00:00Z
sources:
  - resource: https://github.com/OualidGuennif/aeion-template/releases/tag/v4.0.3
    title: "Release v4.0.3"
  - resource: ../../.aeion-template
    title: "The release marker template-update reads"
  - resource: ../../tools/template-tests
    title: "The template suites as this project runs them"
---

# Æion Template v4.0.3

Upstream: `OualidGuennif/aeion-template` (renamed from `aeion-factory`), tag `v4.0.3`, commit
`5b92e13`. Adopted first as Æion Factory v1.7.0 (commit `a2dc66e`, 2026-10-31), updated with
`tools/agents/template-update --ref v4.0.3 --from-ref v1.7.0` on 2026-11-15
([ADR-013](../decisions/ADR-013-aeion-template-v4-without-source-analysis.md)). The read-only
reference clone lives under the ignored `.aeion/reference/`.

## Adopted

- `AGENTS.md` routing, the knowledge format, `work/` task state and `tech-watch/`.
- The checks: knowledge, links, repository health, release and `tools/template-tests`.
- The maintained skills, the harness adapters and the shared hooks, byte for byte, including the doc
  gate (`enforce`) and the 340k/390k context rule.
- The git gates, CI, release flow and the optional loops (off by default). The team git flow runs
  because the owner set `aeion.mode team`.
- Framework mode exists but is off: no aeion-framework address is set.

## Omitted deliberately

- Graphify and Archify (removed by the owner, 2026-11-15), the AxiomSpec engine and `efficiency/`
  (removed upstream), the passive skill/agent pool and the template's `demo/`.
- The template's own decision records (its ADR-001 and ADR-002); ADR-013 carries what applies here.

## Local adaptations

- The architecture spec is `knowledge/architecture/system-overview.md`; the template's
  `template-architecture` page describes the template's own mechanics.
- The TypeScript knowledge checker stays canonical: it enforces more rules than the template's
  Python one, and `tools/template-tests` runs its tests instead.
- Existing public docs (`README.md`, `docs/SECURITY.md`, `docs/KNOWN_LIMITS.md`) win over template
  defaults. Divergences are recorded in [owner preferences](../policies/owner-preferences.md).

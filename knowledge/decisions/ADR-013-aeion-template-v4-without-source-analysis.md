---
type: Decision
title: "ADR-013: Follow Æion Template v4.0.3, without Graphify or Archify"
description: "The project moves from Æion Factory v1.7.0 to Æion Template v4.0.3 through template-update, drops the Graphify/Archify analysis and efficiency/, and keeps framework mode off."
tags: [decision, template, tooling]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T12:25:00Z
sources:
  - id: marker
    resource: ../../.aeion-template
    title: The template release this project follows
  - id: tests
    resource: ../../tools/template-tests
    title: The template suites as this project runs them
  - id: settings
    resource: ../../.claude/settings.json
    title: Hooks, doc gate and the 340k compaction window
---

# ADR-013: Follow Æion Template v4.0.3, without Graphify or Archify

## Context

[ADR-011](ADR-011-adopt-aeion-factory.md) adopted Æion Factory v1.7.0. The template was renamed Æion
Template and reached v4.0.3 (2026-11-15): a doc gate, a 340k/390k context rule, an optional
aeion-framework mode, the `template-update` tool, and no more Graphify, Archify, AxiomSpec engine or
`efficiency/` guide. The owner asked, on 2026-11-15, to take the latest release, to remove Graphify
and Archify entirely and to leave aeion-framework off by default.

## Decision

- Update with `tools/agents/template-update --ref v4.0.3 --from-ref v1.7.0`; `.aeion-template`
  records the release. Connectors and hooks are the template's byte for byte; `AGENTS.md`, the
  settings and the conflicting files were merged by hand, keeping the project's text.
- Remove `tools/architecture/`, its tasks, its CI workflow, the `graph` skill, the
  architecture-maintenance and graph-queries docs, `docs/diagrams.html` and `efficiency/`. No
  analysis receipt is part of done any more.
- Framework mode stays off: no address is set in `.aeion/settings.json` or `AEION_FRAMEWORK_URL`.
  The doc gate keeps the template default, `enforce`; only the owner changes it
  (`tools/aeion-settings`).
- The knowledge checker stays the project's TypeScript one, which enforces more rules than the
  template's Python checker; `tools/template-tests` runs its tests in place of the Python ones.
- The git lifecycle is now off unless `aeion.mode` is `team`; the owner sets it in each clone.

Amended 2026-11-27: the project follows v4.1.1, updated the same way (`--ref v4.1.1`); the
decisions above are unchanged.

## Consequences

- One tool fewer to install; checks need Python 3.12+, Node for the harness plugin tests, and the
  app runtimes.
- A later release is one `template-update` run from a fresh clone of `OualidGuennif/aeion-template`.
- Structural questions are answered by the `Spec:` headers, `tools/knowledge/doc-links --for` and
  the language server, not by a code graph.

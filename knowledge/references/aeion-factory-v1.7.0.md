---
type: Reference
title: "Æion Factory v1.7.0: upstream and local adaptations"
description: "The upstream tag and commit this repository adopts, what was kept, what was omitted and where the local adaptations live."
status: stable
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - resource: https://github.com/OualidGuennif/aeion-factory/releases/tag/v1.7.0
    title: "Release v1.7.0"
  - resource: https://github.com/OualidGuennif/aeion-factory/commit/a2dc66e88a838bcaf58b20eddfbd0a4889cb362d
    title: "The tagged commit"
  - resource: ../../tools/architecture/integrations.json
    title: "The pinned analysis revisions"
---

# Æion Factory v1.7.0

Upstream: tag `v1.7.0`, commit `a2dc66e`, `VERSION` 1.7.0. The read-only reference clone lives under
the ignored `.aeion/reference/aeion-factory`.

## Adopted

- `AGENTS.md` routing, the knowledge format, `work/` task state and `tech-watch/`.
- The checks: knowledge, links, repository health, release and the factory test runner.
- The 16 maintained skills, the harness adapters and the shared hooks (phases 4–5).
- Graphify 0.9.97 and Archify v3.2.0, pinned by commit and hash in `tools/architecture/`.
- The git gates, CI, release flow and the optional loops (off by default).

## Omitted deliberately

- The 525-folder passive skill/agent pool: 13 MB of third-party data that would be the tenth
  top-level folder and does not improve the payment playgrounds.
- `demo/`: the factory's own playground, not this project.
- The factory's `develop`-only examples are retained as policy; this repository's release PR is
  `develop → main` and Render deploys `main`.

## Local adaptations

- The architecture spec is `knowledge/architecture/system-overview.md`; the factory's
  `factory-architecture` page is not imported.
- The Deno knowledge checker stays canonical and is extended with the factory rules; the Python
  `doc-links` and `repo-health` tools are ported as authored.
- Existing public docs (`README.md`, `docs/SECURITY.md`, `docs/KNOWN_LIMITS.md`) win over template
  defaults. Divergences are recorded in [owner preferences](../policies/owner-preferences.md).
- Upstream harness files are excluded from Deno fmt/lint to keep future v1.7.x diffs honest.

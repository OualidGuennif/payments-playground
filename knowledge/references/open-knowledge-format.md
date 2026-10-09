---
type: Reference
title: Open Knowledge Format v0.2
description: "The external format this knowledge/ bundle follows, and this repository's local extensions."
tags: [reference, okf, format]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: spec
    resource: https://github.com/GoogleCloudPlatform/open-knowledge-format
    title: Open Knowledge Format (GitHub)
  - id: validator
    resource: scripts/knowledge-check.ts
    title: The local validator
---

# Open Knowledge Format v0.2

`knowledge/` is an
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format) bundle:
Markdown concepts with YAML frontmatter (`type`, `title`, `description`, `status`, `generated`,
`sources`), organised by directory, each directory with an `index.md` for progressive disclosure.
The root `knowledge/index.md` declares `okf_version: "0.2"`.

Local extensions, enforced by `scripts/knowledge-check.ts`:

- `stale_after`: past this date a stable concept must be re-verified or carry STALE near its top.
- `verified`: a list of `{at, check}` entries for checks actually performed.
- `scope`: at most one stable concept per scope.
- `superseded_by`: required, and must exist, on a deprecated concept.
- A source whose `resource` is a repository path must exist; `git-history:` and URL resources are
  not checked.
- `AGENTS.md` stays under 200 lines and 20 KiB; `CLAUDE.md` is a symlink to it.

The same conventions are used in the owner's Oualstreet repository, from which this layout was
adapted.

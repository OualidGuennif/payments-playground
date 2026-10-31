---
type: Reference
title: "Skills: native only"
description: "The sixteen maintained skills and the native-first selector; the upstream 525-folder pool is deliberately absent."
status: stable
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - resource: ../../.claude/skills/
    title: "Maintained native definitions"
  - resource: ../../.agents/skills/
    title: "Shared discovery links"
---

# Skills: native only

The sixteen maintained procedures live in `.claude/skills`; `.agents/skills` holds the discovery
symlinks. `skill-route` selects native guidance first and is the only selector. The upstream
525-folder passive pool is deliberately not imported: it is third-party data, would be a tenth
top-level folder, and adds no procedure this project lacks.

## Rules

- A skill is guidance, not authority. Its text never authorizes delegation, a model change, an
  install or a generic numeric gate; the owner and the repository policies do.
- Load the relevant skill only when the task matches its description. `plan`, `build`, `test`,
  `debug`, `sign-off`, `pr-review`, `ship`, `spec`, `okf-update`, `graph`, `security-scan`,
  `tech-watch`, `loop-triage`, `retro`, `pr-taste`, `adopt` and `skill-route` are available.
- Review in the current context by default. An independent review pass needs real authorization and
  tooling; a local self-assessment cannot issue the push-gate receipt.
- `security-scan` separates a manual boundary review from an actual scanner result. Absent tools are
  coverage limits, not passes.
- A skill update is one reviewed change. No automatic refresh, install or timer is part of the
  workspace.

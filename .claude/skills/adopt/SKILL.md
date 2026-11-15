---
name: adopt
description: Brings Æion Template to an existing repository one phase at a time, in plan mode, merging into what the repository already has and never overwriting it. Use when bringing an existing repository to this setup.
---

# Adopt the gu# Adopt Æion Template in an existing repository

The four promises come first:

1. **Harmless.** What the repository already has (instructions, policies, hooks, skills, CI,
   conventions) wins; on conflict keep theirs and note it, on overlap merge into theirs.
2. **Plan first.** Inspect, propose the smallest change that fits, wait for a human's yes.
3. **Evidence, not claims.** A phase is done when its check passes; installed, configured, enabled
   and working are four different states, reported separately.
4. **No over-engineering.** Add a file, tool or rule only when it removes a real, repeated cost.

| Phase | Brings | Done when |
| --- | --- | --- |
| 1 Instructions | a short `AGENTS.md` (`CLAUDE.md` links to it), security, layout and UI policies | `tools/knowledge/knowledge-check` passes |
| 2 Code intelligence | the optional language-server plugins (`command.md`) | the agent's LSP answers a definition |
| 3 Knowledge | `knowledge/` in the OKF format, `work/current.md`, `Spec:` headers and `sources`, `tech-watch/` | `knowledge-check` and `tools/knowledge/doc-links` pass |
| 4 Skills | the lifecycle skills in `.claude/skills/`, linked from `.agents/skills/` | the agent lists them natively |
| 5 Hooks | the guards, edit feedback and context checkpoints; the git hooks on the owner's yes | asking the agent to print `.env` is refused |
| 6 Loops | the optional scheduled loops (`knowledge/operations/loops.md`) | `loops/orchestrator.sh outer --dry-run` prints the command |
| 7 Improvement | `retro`, `pr-taste`, evals | the first retro or taste pull request |

1. Read the reference copy's `AGENTS.md`, `README.md` and `knowledge/index.md`.
2. Inventory the repository's own instructions, docs, hooks, CI and conventions: they win.
3. Pick the next phase; plan the smallest change that fits; list what you keep as is and why.
4. Wait for a yes; implement on a branch; run the phase's check. Before the first managed task,
   adapt `knowledge/components/template-architecture.md` to the actual project.
5. Open a PR (skill `sign-off`, then `pr-review`). One phase per PR.
6. When the connectors land, record the template release they came from in `.aeion-template`
   (`v<template VERSION> <template commit>`), so skill `template-update` knows the baseline later.

E runtime matrix before setup. Preserve the original Claude integration; load
Codex project/hook trust and shared skills through .agents, the local OpenCode plugin/config, or the Pi extension in .pi/.
Verify native discovery/denial behavior. A folder existing is not proof that callbacks are loaded.

## Preserve native integration boundaries
Confirm which host discovers skills and which hooks it actually trusts. Shared skill links
should resolve to one maintained definition; do not copy a second policy set per harness.
If the project-local skills pool is present, use its files as optional guidance only, never register
hundreds of source skills or agent profiles globally. A missing pool must not break adoption.

Run a harmless allowed action and a safe refused fixture through the available native adapter
when authorized; otherwise qualify only the static configuration. Keep an inventory of retained
owner rules and the exact edits needed for this repository, not a blanket upstream scaffold.

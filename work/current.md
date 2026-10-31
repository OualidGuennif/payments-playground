# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Æion Factory adoption — ACTIVE

- Owner decision: 2026-10-31, adopt Æion Factory v1.7.0 fully; keep `render.yaml` at the root;
  enable Graphify/Archify, git hooks and the full release flow; use pi headless workers on
  `opencode-go/deepseek-v4.1-flash` with thinking max.
- State: phases 0–5 committed — nine-folder layout, tools and checks, eight-section specs,
  skills/hooks/adapters, CI, and both islands split below 1,500 lines; the complete
  `deno task check` and a fresh exact-HEAD Graphify/Archify receipt are running.
- Next: Docker/verify the four images, record the final status, create the review receipt and open
  the release PR `task/aeion-adoption → main` (who: agent, owner merges).
- Blocker: none.
- Evidence: `.aeion/analysis/3bc6f1dd355dd4acac19c182662ab13f6c8f3ba6/receipt.json`;
  `deno task check`; `deno task factory:test`; `git log --oneline main..HEAD`.

## Production verification after deploy — WAITING-OWNER

- Owner decision: 2026-10-16, look at production after the last deploy; confirm Drop-in in Firefox
  with Adblock Plus.
- State: local checks green; Render has not deployed the adoption branch.
- Next: after the release PR merges, open each service's `/healthz` and one flow in a real browser
  (who: owner).
- Blocker: deferred until the migration reaches `main`.
- Evidence: `render.yaml`; the release PR.

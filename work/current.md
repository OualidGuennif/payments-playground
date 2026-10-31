# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Æion Factory adoption — ACTIVE

- Owner decision: 2026-10-31, adopt Æion Factory v1.7.0 fully; keep `render.yaml` at the root;
  enable Graphify/Archify, git hooks and the full release flow; use pi headless workers on
  `opencode-go/deepseek-v4.1-flash` with thinking max.
- State: phases 0–2 committed (`3245bd0`, `bd7695c`, `3bc6f1d`, `f041649`); `deno task check` green;
  three component-spec workers running; Graphify/Archify PASS on `3bc6f1d`.
- Next: merge the worker specs and update the indexes, then port the 16 skills and the hooks, add
  CI, split the two large islands, and run the final gate (who: agent, owner reviews the result).
- Blocker: none.
- Evidence: `.aeion/analysis/3bc6f1dd355dd4acac19c182662ab13f6c8f3ba6/receipt.json`;
  `deno task check`; `deno task factory:test`.

## Production verification after deploy — WAITING-OWNER

- Owner decision: 2026-10-16, look at production after the last deploy; confirm Drop-in in Firefox
  with Adblock Plus.
- State: local checks green; Render has not deployed the adoption branch.
- Next: after the release PR merges, open each service's `/healthz` and one flow in a real browser
  (who: owner).
- Blocker: deferred until the migration reaches `main`.
- Evidence: `render.yaml`; the release PR.

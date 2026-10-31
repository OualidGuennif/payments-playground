# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Æion Factory adoption — ACTIVE

- Owner decision: 2026-10-31, adopt v1.7.0; Render root; Graphify/Archify; git and release flow; pi
  workers.
- State: phases 0–5 committed; specs, skills, hooks, CI and island splits green; analysis PASS
  `046a604`.
- Next: Docker/verify, final status, then the owner merges the release PR.
- Blocker: none.
- Evidence: `046a604` receipt; `deno task check`; `deno task factory:test`.

## Production verification after deploy — WAITING-OWNER

- Owner decision: 2026-10-16, check production after the last deploy; Drop-in in Firefox.
- State: local gates green; Render has not deployed this branch.
- Next: after the release PR merges, open `/healthz` and one flow in a browser (who: owner).
- Blocker: deferred until `main` deploys.
- Evidence: `render.yaml`; the release PR.

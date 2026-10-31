# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Non-root containers and post-deploy verification — ACTIVE

- Owner decision: 2026-10-31, switch the four images to `deno` after measuring Render's disk; push
  `main` when green.
- State: `task/deno-runtime` ready; local checks and image tests pass; PR open.
- Next: merge the PR, then check each `/healthz`, the digital logs for permission errors and one
  browser flow (who: agent, then owner).
- Blocker: none.
- Evidence: `tools/docker/entrypoint.sh`; `deno task check`; a root-owned named volume became
  `1993:1993` and the digital, IPP and agentic apps answered `/healthz` as uid 1993.

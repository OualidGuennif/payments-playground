# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Every playground on Bun + Next.js + Elysia + Eden — WAITING-OWNER

- Owner decision: 2026-11-15, drop Deno and Fresh everywhere, port every app like the agentic store,
  remove IPP, follow Æion Template v4.0.3 without Graphify/Archify, framework mode off.
- State: done on develop, not pushed: three Next.js apps on Bun, tooling, Docker, CI and docs off
  Deno (ADR-014); `bun run check` green; three images built and run.
- Next: swap the required check "Deno check" for "Bun check" on main, review and push develop,
  release, deploy, TEST webhook on the public origin (who: owner).
- Blocker: none.
- Evidence: work/handovers/a38bcec0-13c5-437d-9c40-1f317f1b63c6.md; CHANGELOG Unreleased.

## Owner browser check after the non-root deploy — WAITING-OWNER

- Owner decision: 2026-10-31, check one real browser flow after the deploy.
- State: all five services are Live on `7b72543`; the health endpoints return 200 and the logs show
  no permission errors.
- Next: open one flow in a browser (who: owner).
- Blocker: none.
- Evidence: PR #3; Render deploy `7b72543`; `deno task check`.

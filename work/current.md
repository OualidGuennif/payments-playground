# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Every playground on Bun + Next.js + Elysia + Eden — ACTIVE

- Owner decision: 2026-11-15, drop Deno and Fresh, port every app; then Claude releases it itself:
  Biome as formatter/linter, independent review, push, release PR, merge, tag, deploy check.
- State: Biome added; review findings fixed with tests; CI scan fixes committed; VERSION 0.2.0
  committed locally on top of develop `1885999` (pushed, Review OK).
- Next: review, push, release PR, merge, tag, verify Render (who: Claude); webhook HMAC key, ipp
  Render service deletion (who: owner).
- Blocker: none.
- Evidence: work/handovers/a38bcec0-13c5-437d-9c40-1f317f1b63c6.md.

## Owner browser check after the non-root deploy — WAITING-OWNER

- Owner decision: 2026-10-31, check one real browser flow after the deploy.
- State: all five services are Live on `7b72543`; the health endpoints return 200 and the logs show
  no permission errors.
- Next: open one flow in a browser (who: owner).
- Blocker: none.
- Evidence: PR #3; Render deploy `7b72543`; `deno task check`.

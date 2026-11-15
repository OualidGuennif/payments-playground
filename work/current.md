# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Agentic commerce demo on Bun + Next.js + Elysia — ACTIVE

- Owner decision: 2026-11-15, rebuild apps/adyen-agentic-commerce as a Bun app (Next.js 16, Elysia,
  Eden) with PAP 1.0, UCP 2026-08-25 over REST and MCP, and a real Adyen TEST payment.
- State: one Next.js app on the Bun runtime; TEST card save, human Drop-in and PAP agent payment
  Authorised locally; 107 bun tests; Docker image, Render env list, tools and docs updated.
- Next: commit on develop and run the full checks (who: Claude); deploy and the TEST webhook on the
  public origin (who: owner).
- Blocker: none.
- Evidence: work/handovers/a38bcec0-13c5-437d-9c40-1f317f1b63c6.md.

## Owner browser check after the non-root deploy — WAITING-OWNER

- Owner decision: 2026-10-31, check one real browser flow after the deploy.
- State: all five services are Live on `7b72543`; the health endpoints return 200 and the logs show
  no permission errors.
- Next: open one flow in a browser (who: owner).
- Blocker: none.
- Evidence: PR #3; Render deploy `7b72543`; `deno task check`.

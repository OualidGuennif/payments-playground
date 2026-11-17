# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Trusted client address for every per-address limit — WAITING-OWNER

- Owner decision: 2026-11-17, push, release pull request and `main` once E2E tests pass.
- State: branch `task/trusted-client-ip` (from develop `4330bc1`) keys every limit and `shopperIP`
  on `CF-Connecting-IP`, then the last `X-Forwarded-For` entry; local E2E through Next pass.
- Next: review, push `develop`, release PR to `main` (who: agent); after the deploy, confirm
  requests on Render carry `CF-Connecting-IP` (who: owner or agent).
- Blocker: none.
- Evidence: agentic spec invariant 10, platform spec invariant 13; Render's DDoS and PocketBase
  articles, Cloudflare's HTTP headers reference.

## Render clean-up after v0.2.0 — WAITING-OWNER

- Owner decision: 2026-11-15, Bun + Next.js everywhere (v0.2.0); 2026-11-17, v0.3.0 released.
- State: digital, styling and agentic serve v0.3.0 (`main` `8d3dd0d`, Next 16.4.6).
- Next: delete the `ipp-endless-aisle` service in the Render dashboard; add
  WEBMCP_ORIGIN_TRIAL_TOKEN to .env.example and Render if wanted (who: owner).
- Blocker: none.
- Evidence: knowledge/current/digital-status.md (v0.3.0 deploy row).

## Owner browser check after the non-root deploy — WAITING-OWNER

- Owner decision: 2026-10-31, check one real browser flow after the deploy.
- State: all five services are Live on `7b72543`; the health endpoints return 200 and the logs show
  no permission errors.
- Next: open one flow in a browser (who: owner).
- Blocker: none.
- Evidence: PR #3; Render deploy `7b72543`; `deno task check`.

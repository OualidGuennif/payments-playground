# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Passkeys on v0.4.0: owner browser check — WAITING-OWNER

- Owner decision: 2026-11-17, ADR-015 approved; agents choose freely between saved card, front
  payment and a network token (number and expiry only, ContAuth, brand from /cardDetails).
- State: v0.4.0 released and deployed (main `e96de08`); passkeys tested only with a software
  authenticator; a network-token payment Authorised locally on Adyen TEST.
- Next: register a real passkey and sign in with it, on `http://localhost:8003` and on Render
  (who: owner).
- Blocker: needs the owner's device.
- Evidence: knowledge/current/digital-status.md (v0.4.0 row); ADR-015.

## Agentic data lost on deploy, disk not in effect — WAITING-OWNER

- Owner decision: 2026-11-17, the Render Blueprint gives agentic a `starter` plan, the
  `agentic-data` disk at `/var/data` and `DATABASE_PATH=/var/data/agentic.sqlite`.
- State: marker `chk_FMh1DGYntPlf`, created after the owner added the 1 GB disk, was 404 after
  the v0.3.4 deploy; no marker was checked across v0.4.0, but accounts and grants share that file.
- Next: in Render, `agentic-commerce` must show the disk mounted at `/var/data` and
  `DATABASE_PATH=/var/data/agentic.sqlite` (or a Blueprint sync); then a new marker (who: owner).
- Blocker: needs the Render dashboard.
- Evidence: knowledge/current/digital-status.md (v0.3.4 rows); render.yaml.

## Client address on Render: two-client check — WAITING-OWNER

- Owner decision: 2026-11-17, v0.3.1 released (the limits key on `CF-Connecting-IP` first).
- State: on Render one client is limited whatever first `X-Forwarded-For` entry it forges, and
  Cloudflare refuses a caller-written `CF-Connecting-IP`; seen from that one client only.
- Next: while one network is at 429 on agentic `/mcp`, a request from another network gets 401,
  not 429; or Render's logs show the header (who: owner).
- Blocker: needs a second network or the Render dashboard.
- Evidence: knowledge/current/digital-status.md (v0.3.1 deploy row).

## Render clean-up after v0.2.0 — WAITING-OWNER

- Owner decision: 2026-11-15, Bun + Next.js everywhere (v0.2.0); 2026-11-17, v0.3.0 and v0.3.1
  released.
- State: digital, styling and agentic serve v0.3.1 (`main` `7f7a242`, Next 16.4.6).
- Next: delete the `ipp-endless-aisle` service in the Render dashboard; add
  WEBMCP_ORIGIN_TRIAL_TOKEN to .env.example and Render if wanted (who: owner).
- Blocker: none.
- Evidence: knowledge/current/digital-status.md (v0.3.0 and v0.3.1 deploy rows).

## Owner browser check after the non-root deploy — WAITING-OWNER

- Owner decision: 2026-10-31, check one real browser flow after the deploy.
- State: all five services are Live on `7b72543`; the health endpoints return 200 and the logs show
  no permission errors.
- Next: open one flow in a browser (who: owner).
- Blocker: none.
- Evidence: PR #3; Render deploy `7b72543`; `deno task check`.

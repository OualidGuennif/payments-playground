# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## v0.7.1: ChatGPT widget fixes, card-save return, MCP stylist & ZIP — ACTIVE

- Owner decision: 2026-11-19, in chat: fix widget checkout revert and composer leak, fix `/account`
  card-save 3DS return, expose stylist instructions/prompt on `/mcp`, fix plugin ZIP, ship to `main`.
- State: code and docs verified on develop (v2 URIs, silent setWidgetState, /api/return, error.tsx,
  MCP prompts, CIMD/OpenAI plugin ZIP); ready for review and PR to main.
- Next: Hydrogen review, push develop, merge PR to main, verify Render live (who: agent).
- Blocker: none.
- Evidence: bun run check exit 0 (413 agentic + 107 workspace tests, 3 builds + SSR, template-tests).

## ChatGPT pays with a saved card through the v0.6.0 consent — WAITING-OWNER

- Owner decision: 2026-11-18, in chat: test ChatGPT buying with a card saved in the account.
- State: v0.6.0 released and deployed (main `c072111`, tag `v0.6.0`); no agent has paid with a
  saved card through the new consent screen yet (the last one on Render was v0.3.3's PAP agent).
- Next: save an Adyen test card on the account, reconnect ChatGPT (allow "Pay with your saved
  card", budget above the price), ask it to pay with the saved card (who: owner); then read the
  Back Office trace and order (who: agent).
- Blocker: needs the owner's ChatGPT.
- Evidence: knowledge/current/digital-status.md (v0.6.0 deploy row).

## Passkeys on v0.4.0: owner browser check — WAITING-OWNER

- Owner decision: 2026-11-17, ADR-015 approved; agents choose freely between saved card, front
  payment and a network token (number and expiry only, ContAuth, brand from /cardDetails).
- State: v0.4.0 released and deployed (main `e96de08`); passkeys tested only with a software
  authenticator; a network-token payment Authorised locally on Adyen TEST.
- Next: register a real passkey and sign in with it, on `http://localhost:8003` and on Render
  (who: owner).
- Blocker: needs the owner's device.
- Evidence: knowledge/current/digital-status.md (v0.4.0 row); ADR-015.

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

# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Reorganize the three apps' code layout — ACTIVE

- Owner decision: 2026-11-25, in chat: plan approved; digital, then styling, then agentic;
  moves and splits only, no stack, URL or behaviour change.
- State: digital components in folders, CSS split in `src/styles/`, server split into
  `src/server/routes/`; typecheck, 27 tests and a TEST browser smoke pass; committed on `develop`
  (unpushed).
- Next: split FlowWorkbench into per-flow modules, then styling, then agentic (who: agent).
- Blocker: none.
- Evidence: work/handovers/94e4267a-bf92-4a2a-87d6-a4fe6b39647b.md.

## v0.7.1: ChatGPT widget fixes, card-save return, MCP stylist & ZIP — WAITING-OWNER

- Owner decision: 2026-11-19, in chat: fix widget checkout revert and composer leak, fix `/account`
  card-save 3DS return, expose stylist instructions/prompt on `/mcp`, fix plugin ZIP, ship to `main`.
- State: v0.7.1 merged via PR #18 (`10b59cb`), CI `44434136862` green, tag `v0.7.1`, Render live
  (`dep-dbv4mejm8hqs73almun0`, 01:06:53 UTC); live `/healthz`, `/docs/chatgpt`, ZIP, `/api/return`, `/mcp` 401 verified.
- Next: Refresh ChatGPT MCP connector, test card save on `/account#cards` and live widget checkout (who: owner).
- Blocker: needs the owner's ChatGPT and browser.
- Evidence: knowledge/current/digital-status.md (v0.7.1 deploy row); GitHub release v0.7.1.

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

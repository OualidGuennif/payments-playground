# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Flagship storefront on the agentic store (ADR-019) — ACTIVE

- Owner decision: 2026-11-27, in chat: implement the six-slice flagship plan and ship it to prod.
- State: v0.10.0 merged (PR #24, main `0417872`) but its agentic image failed on Render (a test
  imported packages/ui); prod still v0.9.3. Fix uncommitted: test moved to packages/ui, guard test.
- Next: local Docker build, review, release 0.10.1, merge, deploy, prod check (who: agent); visual
  yes on prod and a signed-in check (who: owner).
- Blocker: none.
- Evidence: knowledge/components/agentic-storefront.md; ADR-019.

## Ask agent on the agentic store, a PAP agent — WAITING-OWNER

- Owner decision: 2026-11-26, v0.9.1 released; same day "fixe tout": canonical host, account email
  on the receipt when signed in, delivery standard/express/pickup point with preset places, test live.
- State: v0.9.3 live (delivery, account receipt, onrender host 308; guest flows checked live). The
  voice password's value is in ask-agent.md, config.test.ts and CHANGELOG.md, repository public.
- Next: signed-in receipt and delivery with the owner's throwaway account (who: owner, then agent);
  rotate `VOICE_MODE_PASSWORD` on Render (who: owner); Pi exemption ends 12-02.
- Blocker: none.
- Evidence: knowledge/current/digital-status.md (v0.9.3 deploy row); GitHub release v0.9.3.

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

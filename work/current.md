# Current work

Task state only. One entry per open task, newest first. At most 150 lines, 10 per entry. Finished
tasks are deleted: the commit message and knowledge/ keep what matters. Status: ACTIVE,
WAITING-OWNER, MEASURING, BLOCKED, BACKLOG. An entry is `## <title> — <STATUS>`, then the lines
`- Owner decision:`, `- State:`, `- Next:` (with who), `- Blocker:`, `- Evidence:`.

## Agentic interoperability fixes from the Atelier Velune report — ACTIVE

- Owner decision: 2026-11-16, the findings, Gemini's UI, WebMCP, Next 16.4.6; 2026-11-17, visual
  yes, PAP §4.7 delegated (PAP agents must send scope), release to main.
- State: §4.7 rule on develop; release develop → main in progress.
- Next: review, release PR, merge, tag, deploy check (who: agent); add WEBMCP_ORIGIN_TRIAL_TOKEN
  to .env.example and Render if wanted (who: owner).
- Blocker: none.
- Evidence: `bun run check` green; review receipts in `.aeion/reviews/`; pap-agent on TEST.

## Render clean-up after v0.2.0 — WAITING-OWNER

- Owner decision: 2026-11-15, Bun + Next.js everywhere, released as v0.2.0 (PR #5, `940e3b0`).
- State: digital, styling and agentic serve the new build; `agentic.payments-playground.com`
  resolves to Render since 2026-11-16 (`/healthz` 200).
- Next: delete the `ipp-endless-aisle` service in the Render dashboard (who: owner).
- Blocker: none.
- Evidence: knowledge/current/digital-status.md (v0.2.0 deploy row).

## Owner browser check after the non-root deploy — WAITING-OWNER

- Owner decision: 2026-10-31, check one real browser flow after the deploy.
- State: all five services are Live on `7b72543`; the health endpoints return 200 and the logs show
  no permission errors.
- Next: open one flow in a browser (who: owner).
- Blocker: none.
- Evidence: PR #3; Render deploy `7b72543`; `deno task check`.

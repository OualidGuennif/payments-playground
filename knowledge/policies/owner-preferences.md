---
type: Policy
title: "The owner's preferences"
description: "Durable project preferences: Render at the root, TEST only, the factory scope, the toolchain, the pi worker model and the agentic store's Pay and offer choices."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T16:00:00Z
sources:
  - resource: ../../AGENTS.md
    title: "Project rules and owner"
  - resource: ../../render.yaml
    title: "Root deployment blueprint"
  - resource: ../../.aeion-template
    title: "The template release followed"
---

# The owner's preferences

What the owner asked for that a reviewer should not have to ask again.

## Delivery

- `render.yaml` stays at the repository root; its services, Docker contexts, health checks and
  Render auto-deploy from `main` are not moved. The IPP app and its `ipp-endless-aisle` service were
  removed at the owner's request (2026-11-15); every remaining app moves to Bun + Next.js + Elysia +
  Eden, and Deno and Fresh leave the repository.
- Work reaches `main` through `develop` and a reviewed release pull request. `main` is the deploy
  branch.
- Git is enabled: `tools/git-hooks` pre-commit and pre-push, with review receipts in
  `.aeion/reviews`.
- The factory starts at `VERSION` 0.1.0; the first release is tagged `v0.1.0`.

## Scope

- The 525-folder passive skill pool and the `demo/` playground are deliberately omitted. The 16
  maintained procedures live in `.claude/skills`.
- At most nine top-level folders, named by role; `tools/` is the one home for scripts and checks.
- TEST only; never add a LIVE path. Adyen Web 6.48.1 and Checkout API v72 stay pinned.
- The agentic store is Bun inside Next.js, not beside it: one Next.js app on the Bun runtime with
  Elysia in its route handlers and Eden in the browser (2026-11-15,
  [ADR-012](../decisions/ADR-012-agentic-app-on-bun-and-next.md)). Its Render service keeps its name
  and place in the root Blueprint; on 2026-11-17 the owner moved it to `starter` with a 1 GB disk,
  like Digital and styling, so its orders and agents survive a deploy.
- The agentic store must let real MCP clients such as ChatGPT sign in; where a protocol rule blocks
  one, the owner decides, and each departure from PAP 1.0 is an ADR (2026-11-18,
  [ADR-016](../decisions/ADR-016-client-assertion-audience-for-mcp-clients.md)).
- On the agentic store, Pay asks for an email in one modal that may tell whether the address has
  an account, through a hardened boolean check (same origin, a custom header, 15 per 15 minutes
  per address, a timing floor, a masked trace); sign-in stays one generic refusal. A first order
  may take 5 % off and a free seasonal tote, opt-in and priced on the server. Seasons start on
  the 21st of the month before the solstice or equinox. Sign in sits in the header on every width,
  and the top bar is a seasonal sandbox line (2026-11-27,
  [ADR-020](../decisions/ADR-020-pay-identity-welcome-offer-and-seasons.md)).
- On the agentic store, the Personal Shopper remembers an account's grant across conversations,
  sign-ins and deploys (one active grant per account; Disconnect on `/account#agents` ends it), asks
  for the password or a passkey only to pay in the chat and only when the last proof is over 60
  minutes old, never sends the shopper out of the chat on Pay (overlays above it; "Continue on
  website checkout" is the last, quieter choice), leads with "Pay in chat" or "Save a card & pay in
  chat", opens at 88 % of the screen on a phone with little chrome, keeps product cards compact and
  aligned, puts every overlay where the iOS keyboard cannot cover it, and wears a restrained glass
  finish (2026-11-27, [ADR-021](../decisions/ADR-021-durable-ask-grant-step-up-and-in-chat-checkout.md)).
- The agentic checkout asks for the email in step 1 before Delivery and Payment open, and a paid
  order opens its own page at the top (2026-11-27, iPhone Safari).
- Existing public docs (`README.md`, `docs/SECURITY.md`, `docs/KNOWN_LIMITS.md`) win over factory
  defaults where they differ; record the divergence here.

## Toolchain

- Bun 1.4.4 and Python 3.12+ (excluding 3.14.1); Deno, Fresh, Hono and Vite are gone (2026-11-15).
- Æion Template v4.1.1 through `template-update` (2026-11-27, owner's yes; v4.0.3 since 2026-11-15); Graphify and Archify are removed and
  must not come back; aeion-framework mode stays off by default
  ([ADR-013](../decisions/ADR-013-aeion-template-v4-without-source-analysis.md)). The owner sets
  `aeion.mode team` in each clone.
- Pi workers use `opencode-go/deepseek-v4.1-flash`, headless, `--thinking max`, one scoped brief per
  worker.
- Docker images start as root only for `tools/docker/entrypoint.sh` to chown the Render disk and
  `/app/data` to uid 1993, then drop to the `app` user; the missing-user SAST rules stay waived
  inline in the Dockerfiles (2026-10-31, measured disk `root:1000`).

## Workflow

- Plan first; wait for the owner's yes.
- Keep reasoning private; speak only for a decision or a concise result.
- Report the verification level actually reached; never claim a browser, webhook or deploy check
  that was not run.

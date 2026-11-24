---
type: Runbook
title: "Local development of adyen-digital"
description: "Starting the dev server, the .env it reads, which origin redirects use, when to restart, test cards, browser caveats, and how to read the local database."
tags: [runbook, dev, digital]
status: stable
scope: local-development
generated:
  by: claude-code/opus-5.5
  at: 2026-11-25T10:00:00Z
sources:
  - id: readme
    resource: ../../apps/adyen-digital/README.md
    title: Environment variables
  - id: config
    resource: ../../packages/platform/config.ts
    title: How env and .env files are read
  - id: next
    resource: ../../apps/adyen-digital/next.config.ts
    title: Next.js configuration
---

# Local development of adyen-digital

## Start

```bash
bun run dev:digital                        # from the root: http://localhost:8001
```

It reads `apps/adyen-digital/.env` (copy `.env.example`; four Adyen values are required: API key,
merchant account, `test_` client key, HMAC key). Process environment wins over the file; values may
be quoted. `tools/dev/bun-app.ts` reads the file with `packages/platform/dotenv.ts`, which never
expands `$name`, and tells Next the environment is already loaded. The
client key's allowed origins in the Customer Area must include the origin you browse
on.

`PUBLIC_ORIGIN` only has to be right for webhooks and deployments. Redirects (`returnUrl`) and the
3DS `origin` follow the browser's own same-host origin, so any local port works
([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## When to restart

- After editing `next.config.ts`, `.env` or a dependency: stop `bun run dev:digital` and start it
  again. Next reloads pages, components and `src/server/` on its own.
- The Vite-era restart rules (a stale SSR graph, `_fresh/` and SQLite watchers) ended with the move
  to Next.js on 2026-11-15.

## Paying on TEST

Use Adyen's published test cards (Adyen docs, "Test card numbers"). Two that are exercised here:

- `4917 6100 0000 0000`, expiry `03/30`, CVC `737`: Visa with a 3DS2 challenge. Adyen's simulator
  asks for the word `password`.
- A stored card appears under "Saved payment methods" once a card is saved under this week's
  `shopperReference` (`playground-shopper-<Monday>`). Amex needs a four-digit CVC (`7373`).

In the browser pane, a secured field (an Adyen iframe) sometimes ignores the first click; click
again before typing.

## Browsers

Ad blockers and Firefox's tracking protection block URLs containing "analytics".
[ADR-006](../decisions/ADR-006-adyen-web-one-bundle-in-dev.md) made Vite serve Adyen Web as one
file in dev; Next.js puts it inside its own chunks, whose URLs carry no module path (not yet
re-checked with an ad blocker on). Adyen's own `checkoutanalytics-test.adyen.com` call is still
blocked; it is optional and harmless. Reproduce browser-specific problems in that browser, or in
headless Firefox (`firefox --headless --remote-debugging-port`) driven over WebDriver BiDi.

## Reading the local database

The dev server writes `apps/adyen-digital/data/digital.sqlite`. Read it without locking the server:

```bash
sqlite3 -readonly apps/adyen-digital/data/digital.sqlite \
  "select flow, state, paid_value from orders order by updated_at desc limit 5;"
```

`api_calls` holds each request and response as JSON (`json_extract` works on them),
`webhooks.hmac_valid` the HMAC verdict, `frontend_callbacks` what the workbench reported.

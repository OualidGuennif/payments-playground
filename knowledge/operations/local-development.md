---
type: Runbook
title: "Local development of adyen-digital"
description: "Starting the dev server, the .env it reads, which origin redirects use, when to restart, test cards, browser caveats, and how to read the local database."
tags: [runbook, dev, digital]
status: stable
scope: local-development
generated:
  by: claude-code/opus-5.5
  at: 2026-10-16T15:15:00Z
sources:
  - id: readme
    resource: ../../apps/adyen-digital/README.md
    title: Environment variables
  - id: config
    resource: ../../packages/platform/config.ts
    title: How env and .env files are read
  - id: vite
    resource: ../../apps/adyen-digital/vite.config.ts
    title: Dev server plugins
---

# Local development of adyen-digital

## Start

```bash
deno task dev:digital                      # from the root: http://localhost:8001
deno task --cwd apps/adyen-digital dev     # Vite's default port: http://localhost:5173
```

Both read `apps/adyen-digital/.env` (copy `.env.example`; four Adyen values are required: API key,
merchant account, `test_` client key, HMAC key). Process environment wins over the file; values may
be quoted. The client key's allowed origins in the Customer Area must include the origin you browse
on.

`PUBLIC_ORIGIN` only has to be right for webhooks and deployments. Redirects (`returnUrl`) and the
3DS `origin` follow the browser's own same-host origin, so 5173 and 8001 both work
([ADR-008](../decisions/ADR-008-redirects-follow-the-browser-origin.md)).

## When to restart

- After editing anything under `packages/platform` or `packages/ui/components.tsx`: the SSR graph
  can go stale (`... is not a function`, or a page still served with the old markup). Touch
  `apps/adyen-digital/vite.config.ts`; Vite restarts.
- If that restart stops at "restarting server..." and the port stops answering, touch the file once
  more; seen twice on 2026-10-10, on digital and styling.
- After an Adyen Web version change: the dev bundle is built once per start.
- Not needed after `deno task check` or a build: digital and styling's Vite ignores `_fresh/`, so a
  build no longer reloads open dev pages (each Sessions reload used to create an empty order).
- A page that reloads by itself in dev is Fresh's plugin reacting to a watched file: every app's
  Vite also ignores its SQLite files, which change on each request (fixed 2026-10-16).

## Paying on TEST

Use Adyen's published test cards (Adyen docs, "Test card numbers"). Two that are exercised here:

- `4917 6100 0000 0000`, expiry `03/30`, CVC `737`: Visa with a 3DS2 challenge. Adyen's simulator
  asks for the word `password`.
- A stored card appears under "Saved payment methods" once a card is saved under this week's
  `shopperReference` (`playground-shopper-<Monday>`). Amex needs a four-digit CVC (`7373`).

In the browser pane, a secured field (an Adyen iframe) sometimes ignores the first click; click
again before typing.

## Browsers

Ad blockers and Firefox's tracking protection block URLs containing "analytics". Since
[ADR-006](../decisions/ADR-006-adyen-web-one-bundle-in-dev.md) Adyen Web loads as one file in dev,
so Drop-in renders with them on. Adyen's own `checkoutanalytics-test.adyen.com` call is still
blocked; it is optional and harmless. Reproduce browser-specific problems in that browser, or in
headless Firefox (`firefox --headless --remote-debugging-port`) driven over WebDriver BiDi.

## Reading the local database

The dev server writes `apps/adyen-digital/data/digital.sqlite`. Read it without locking the server:

```bash
sqlite3 -readonly apps/adyen-digital/data/digital.sqlite \
  "select flow, state, paid_value from orders order by updated_at desc limit 5;"
```

`api_calls` holds each request and response as JSON (`json_extract` works on them),
`webhooks.hmac_valid` the HMAC verdict, `frontend_callbacks` what the island reported.

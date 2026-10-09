---
type: Runbook
title: "Webhooks locally, without a tunnel"
description: "Three ways to get Adyen notifications into a local server: replay a notification signed with the local HMAC key, read the real ones captured by webhook.site, or open a tunnel; and why real notifications only verify with their own endpoint's HMAC key."
tags: [runbook, webhooks, hmac, local]
status: stable
scope: webhooks-locally
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: hmac
    resource: packages/platform/hmac.ts
    title: calculateStandardHmac and verifyStandardHmac
  - id: handler
    resource: apps/adyen-digital/api.ts
    title: POST /webhook
verified:
  - at: 2026-10-09
    check: "A CAPTURE notification signed with the local ADYEN_HMAC_KEY and posted to localhost:5173/webhook answered 202 and settled the order paid. Real notifications read from webhook.site matched that shape; replayed with their own signature they answered 401 locally, as expected."
---

# Webhooks locally, without a tunnel

Adyen only delivers to a public URL, so the local server never receives notifications by itself.
Production receives them at `https://digital.payments-playground.com/webhook`.

## 1. Replay a notification signed with the local key

Build a standard notification item (`pspReference`, `originalReference` for modifications,
`merchantAccountCode`, `merchantReference`, `amount`, `eventCode`, `success`), sign it with
`calculateStandardHmac(item, ADYEN_HMAC_KEY)` from `packages/platform/hmac.ts`, put the signature in
`additionalData.hmacSignature`, and POST
`{"live":"false","notificationItems":[{"NotificationRequestItem": item}]}` to
`http://localhost:<port>/webhook`. Read the key from the app's `.env` inside the script; never print
it. `/webhook` is outside `/api/*`, so no CSRF token is needed.

This proves the handler (HMAC, correlation, state change). It is not Adyen's delivery: report it as
a simulated notification.

## 2. Read the real notifications on webhook.site

A webhook.site endpoint is configured as an extra webhook in the Customer Area. Its API key lives in
a `.env.local` file (git- and docker-ignored) as `WEBHOOK_SITE_API_KEY`;
`GET https://webhook.site/token/<token id>/requests?sorting=newest` with header `Api-Key` lists the
captured requests, whose `content` is Adyen's JSON.

Each webhook endpoint in the Customer Area has **its own HMAC key**. Real notifications captured
there are signed with that endpoint's key, so replayed locally they verify only if the local
`ADYEN_HMAC_KEY` is that same key. Otherwise they are recorded with `hmac_valid = 0`, correlated,
and not processed (401), which is the correct behaviour.

## 3. Tunnel

`cloudflared` or `ngrok` to the dev port, `PUBLIC_ORIGIN` set to the tunnel URL, a TEST webhook
pointed at `${PUBLIC_ORIGIN}/webhook` with its HMAC key in `ADYEN_HMAC_KEY`, and the tunnel origin
allowed on the client key.

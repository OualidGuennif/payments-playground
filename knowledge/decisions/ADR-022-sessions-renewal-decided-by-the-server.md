---
type: Decision
title: "ADR-022: The server decides when a Sessions order gets a new session"
description: "A Sessions order keeps its order and gets a new Adyen session only when its HMAC-valid AUTHORISATION webhooks show five refusals for the current session's checkoutSessionId; the browser asks, it never decides."
tags: [decision, sessions, webhooks, lifecycle]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T21:15:00Z
sources:
  - id: route
    resource: ../../apps/adyen-digital/src/server/routes/sessions.ts
    title: "POST /api/digital/orders/:id/sessions"
  - id: decision
    resource: ../../apps/adyen-digital/src/server/session-renewal.ts
    title: "renewalDecision, the pure rule"
  - id: storage
    resource: ../../packages/platform/storage.ts
    title: "latestSession, claimSession, sessionRefusals, orderMetadata"
  - id: notes
    resource: ../references/adyen-checkout-api-notes.md
    title: "A session takes 5 refused payments (seen on TEST, 2026-10-16)"
---

# ADR-022: The server decides when a Sessions order gets a new session

**Context.** Adyen takes five refused payments in one session; the sixth answers 422 `14_0422`
([notes](../references/adyen-checkout-api-notes.md)). Until 2026-11-27 the workbench counted the
refusals itself and, past five or on a 422, created a new order with a new session: the browser
decided, and the server created whatever it was asked for. A merchant reviewing the playground
(2026-11-27) pointed out that a backend should not trust the front for that, nor poll
`GET /sessions/{id}`, which [ADR-007](ADR-007-order-state-from-authoritative-events.md) already
rules out.

**Decision.**

- `POST /api/digital/orders/:id/sessions` renews the session of an existing Sessions order. The
  browser only asks; the server answers from what it already knows.
- It counts the refusals Adyen reported itself: HMAC-valid AUTHORISATION webhooks with
  `success=false` whose `additionalData.checkoutSessionId` is the current session's Adyen id, once
  per PSP reference. Seen on TEST: an AUTHORISATION webhook of a Sessions payment carries
  `checkoutSessionId` (2026-10-09, order `d13195db`).
- Below five, it answers 202 with the count and the browser waits. At five it creates a new
  session for the same order (same `reference`, the order's amount and expiry) and marks the old
  one `replaced`. A paid, pending, part-paid, cancelled or expired order is refused with 409.
- One order, many sessions over its life, at most one in use: the session is claimed before Adyen
  is called, so two requests at once create one session.
- No refusal webhook, or none naming the session, means no renewal: the browser's wait ends in a
  timeout, never in a new session (fail closed).

**Consequences.** Locally, without a tunnel or a replay, refusal webhooks never arrive, so a
renewal waits and times out
([runbook](../operations/webhooks-without-a-tunnel.md)). An expired order is not renewed: it
expires with its first session (25 minutes) and a new checkout starts, as before. A part-paid order
(gift card) is not renewed. The webhook dedupe ignores the HMAC verdict (open gap 2 in
[digital-status](../current/digital-status.md)): a forged delivery stored first would hide the
valid one from the count, which can only delay a renewal, never grant one. Still to verify on
Render: that a refused AUTHORISATION webhook carries `checkoutSessionId` too.

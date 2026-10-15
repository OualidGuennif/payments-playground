---
type: Decision
title: "ADR-007: An order's state comes only from authoritative events"
description: "Order state is re-derived from attempts plus Adyen's own answers (API results, webhooks); a refusal never closes an order; paid and cancelled are settled and never reopened."
tags: [decision, state-machine, lifecycle]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-15T08:00:00Z
sources:
  - id: state-machine
    resource: packages/platform/state-machine.ts
    title: resolveOrder
  - id: tests
    resource: packages/platform/state-machine.test.ts
    title: Invariant tests
  - id: api
    resource: apps/adyen-digital/api.ts
    title: settleAttempt, resolveAndStore, webhook handler
---

# ADR-007: An order's state comes only from authoritative events

**Context.** Until 2026-10-09 only the first `/payments` response was recorded: 3DS outcomes,
Sessions outcomes and CAPTURE/CANCELLATION webhooks never reached the order, so most orders stayed
`open` or `payment_pending` and refunds were unreachable.

**Decision.**

- The browser never decides an outcome. Outcomes come from `/payments`, `/payments/details`,
  `GET /paymentLinks/{id}` and HMAC-valid webhooks.
- Amended 2026-10-15 (owner): `GET /sessions/{id}` is no longer a source and is never called. Adyen
  documents that the status it returns is not updated after the first answer and must not be polled;
  a Sessions order is settled by its AUTHORISATION webhook (or `/payments/details` after a
  redirect).
- `resolveOrder` re-derives the state from attempts and at most one terminal event each time.
- A refusal ends an attempt, never an order.
- `paid` and `cancelled` are settled: a later event (a REFUND after a CAPTURE) never reopens them.

**Consequences.** Without webhooks, a card order stops at `payment_pending` (authorised); only a
CAPTURE webhook makes it `paid`. See [the lifecycle](../architecture/payment-lifecycle.md) and the
open gaps in [current/digital-status.md](../current/digital-status.md).

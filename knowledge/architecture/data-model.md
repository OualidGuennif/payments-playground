---
type: Architecture
title: "Data model: one SQLite file per app, ten tables, idempotency by constraint"
description: "Where each app stores its data, the ten tables, which unique constraints make redelivery and double clicks harmless, the per-app retention cap, profile encryption, and what the timeline view merges."
tags: [architecture, sqlite, storage, idempotency]
status: stable
scope: data-model
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T13:00:00Z
sources:
  - id: schema
    resource: ../../packages/platform/migrations/001_initial.sql
    title: The schema
  - id: storage
    resource: ../../packages/platform/storage.ts
    title: Repository, retention cap, timeline
  - id: profiles
    resource: ../../packages/platform/profiles.ts
    title: Encrypted profiles
---

# Data model

Each app owns one SQLite database in WAL mode
([ADR-003](../decisions/ADR-003-sqlite-single-instance.md)). The path is `DATABASE_PATH`, by default
`./data/<app>.sqlite` relative to the process's working directory: `apps/<app>/data/` for
`deno task dev` inside the app, the repository's `data/` when the tests import the APIs, and
`/var/data/` on Render's persistent disk.

## Tables

| Table                | Holds                                                              | Uniqueness                   |
| -------------------- | ------------------------------------------------------------------ | ---------------------------- |
| `profiles`           | Extra TEST merchant profiles, encrypted (AES-256-GCM)              | id                           |
| `orders`             | One per checkout: flow, amount, state, paid value, expiry, link id | `reference`                  |
| `payment_sessions`   | The Adyen session id a Sessions order was created with             |                              |
| `attempts`           | One per authorisation try, with PSP reference and refusal reason   |                              |
| `payment_parts`      | One per authorised PSP reference                                   | enforced in code (see below) |
| `api_calls`          | Every Checkout API request and response, redacted, with duration   |                              |
| `frontend_callbacks` | Adyen Web callbacks the island reported                            |                              |
| `webhooks`           | Every notification item, with its HMAC verdict                     | `dedupe_key`                 |
| `lifecycle_actions`  | Capture, cancel and refund requests                                | `idempotency_key`            |
| `audit_log`          | Session creation, profile changes, unhandled errors                |                              |

`dedupe_key` (`pspReference:originalReference:eventCode:success`) and `idempotency_key` make a
redelivered webhook and a double-clicked action harmless by construction. `payment_parts` has no
constraint, so `recordPaymentPart` returns the existing row for the same order, PSP reference and
state.

## Retention

Each app keeps its 70 most recently updated orders; older ones are purged on the next order
creation, with their attempts, parts and sessions (cascade). Log rows keyed by correlation id are
not purged. It is a playground: nothing here is a record of anything.

## The timeline

`timeline(correlationId)` merges API calls (with their method and endpoint), frontend callbacks,
webhooks and lifecycle actions for one correlation id, oldest first. The inspector polls it every
2.5 s while open; the Back Office shows it per order. The Advanced flow mints one correlation id for
`/paymentMethods` and another for the order created by `/payments`, so the inspector polls and
merges both.

## Profiles

The default profile comes from environment variables only and cannot be deleted. Profiles added in
Settings are encrypted with `PROFILE_ENCRYPTION_KEY`, or, locally, a key file generated next to the
database. The key is required on a hosted deployment. Rotating it means recreating every stored
profile.

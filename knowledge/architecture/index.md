---
type: Reference
title: Architecture index
description: "How the playgrounds are put together, end to end."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-15T21:00:00Z
---

# Architecture

| Concept                                                    | Status | Notes                                                          |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| [System overview](system-overview.md)                      | stable | Workspace, one app's anatomy, client boundary, ports           |
| [Payment lifecycle in adyen-digital](payment-lifecycle.md) | stable | Orders, attempts, state derivation, webhooks, capture/refund   |
| [Data model](data-model.md)                                | stable | Tables, idempotency constraints, retention, profiles           |
| [Dev and build pipeline](dev-build-pipeline.md)            | stable | Next.js on Bun, Turbopack, standalone builds, dev caveats      |

---
type: Reference
title: Architecture index
description: "How the playgrounds are put together, end to end."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
---

# Architecture

| Concept                                                    | Status | Notes                                                          |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| [System overview](system-overview.md)                      | stable | Workspace, one app's anatomy, islands boundary, ports          |
| [Payment lifecycle in adyen-digital](payment-lifecycle.md) | stable | Orders, attempts, state derivation, webhooks, capture/refund   |
| [Data model](data-model.md)                                | stable | Tables, idempotency constraints, retention, profiles           |
| [Dev and build pipeline](dev-build-pipeline.md)            | stable | Vite + Deno loader, the three local plugins, SSR reload caveat |

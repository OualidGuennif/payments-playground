---
type: Decision
title: "ADR-003: SQLite on a single instance"
description: "Each app persists to its own SQLite file in WAL mode on one instance, with a persistent disk where it matters, rather than a shared database server."
tags: [decision, storage]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: storage
    resource: ../../packages/platform/storage.ts
    title: Repository
  - id: render
    resource: ../../render.yaml
    title: Persistent disks on digital and styling
---

# ADR-003: SQLite on a single instance

**Context.** A playground needs durable observability (orders, API calls, webhooks) but no scale.

**Decision.** One SQLite file per app, WAL mode, unique constraints for idempotency. On Render,
digital and styling each have a 1 GB persistent disk at `/var/data`; IPP and agentic run without a
disk and lose their data on each deploy.

**Consequences.** One replica only. Several replicas would need PostgreSQL, a webhook queue,
distributed locking and a shared rate limiter, none of which exist. Backups are not automated.

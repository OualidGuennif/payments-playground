---
type: Reference
title: Operations index
description: "How to build, run, test, ship and upgrade."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
---

# Operations

| Runbook                                                            | Status | Notes                                                  |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------ |
| [Build and test](build-and-test.md)                                | stable | Tasks, what `check` runs, network tests, Deno versions |
| [Local development of adyen-digital](local-development.md)         | stable | Ports, `.env`, restarts, test cards, browsers, the DB  |
| [Webhooks locally, without a tunnel](webhooks-without-a-tunnel.md) | stable | Signed replay, webhook.site, tunnel; HMAC per endpoint |
| [Docker images and the Render deployment](docker-and-render.md)    | stable | Build context, env files, Blueprint, checking a deploy |
| [Upgrading Adyen Web](adyen-web-upgrade.md)                        | stable | The seven-step checklist                               |
| [The loops](loops.md)                                              | stable | Inner, middle and outer loops, off by default          |
| [Graphify and Archify](architecture-maintenance.md)                | stable | Pinned analysis, source anchors, CI refresh            |
| [Agent compatibility](agent-compatibility.md)                      | stable | Claude, Codex, OpenCode, Pi, dsh, Devin, Droid         |
| [Context safety](context-safety.md)                                | stable | 250k closure, verified handover, compaction            |
| [Getting started](getting-started.md)                              | stable | First-run setup and managed launch commands            |
| [GitHub main protection](github-protection.md)                     | stable | Required reviews and checks on `main`                  |
| [Skills](skill-selection.md)                                       | stable | Native-first selection; no passive pool                |

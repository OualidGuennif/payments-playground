---
type: Reference
title: Operations index
description: "How to build, run, test, ship and upgrade."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-15T21:00:00Z
---

# Operations

| Runbook                                                            | Status | Notes                                                  |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------ |
| [Build and test](build-and-test.md)                                | stable | Scripts, what `check` runs, network tests, Bun version |
| [Local development of adyen-digital](local-development.md)         | stable | Ports, `.env`, restarts, test cards, browsers, the DB  |
| [Webhooks locally, without a tunnel](webhooks-without-a-tunnel.md) | stable | Signed replay, webhook.site, tunnel; HMAC per endpoint |
| [Docker images and the Render deployment](docker-and-render.md)    | stable | Build context, env files, Blueprint, checking a deploy |
| [Upgrading Adyen Web](adyen-web-upgrade.md)                        | stable | The seven-step checklist                               |
| [The loops](loops.md)                                              | stable | Inner, middle and outer loops, off by default          |
| [Updating to a template release](template-update.md)               | stable | `tools/agents/template-update`, file classes, merges   |
| [Local evaluation harness](evals.md)                               | draft  | Appended run records and a three-number report         |
| [Agent compatibility](agent-compatibility.md)                      | stable | Claude, Codex, OpenCode, Pi, dsh, Devin, Droid         |
| [Context safety](context-safety.md)                                | stable | 340k closure, verified handover, compaction            |
| [Getting started](getting-started.md)                              | stable | First-run setup and managed launch commands            |
| [GitHub main protection](github-protection.md)                     | stable | Required reviews and checks on `main`                  |
| [Skills](skill-selection.md)                                       | stable | Native-first selection; no passive pool                |

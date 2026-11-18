---
type: Reference
title: Decisions index
description: "One architecture decision record per durable choice."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-18T13:31:04Z
---

# Decisions

Each ADR states its context, the decision and its consequences. Supersede an ADR with a new one
(`status: deprecated` plus `superseded_by`) rather than rewriting it.

| ADR                                                                                                           | Status | Decided                  |
| ------------------------------------------------------------------------------------------------------------- | ------ | ------------------------ |
| [ADR-001: TEST only, enforced in code](ADR-001-test-only-enforced-in-code.md)                                 | stable | before 2026-08           |
| [ADR-002: The official Adyen Node library, not fetch](ADR-002-official-adyen-node-library.md)                 | stable | before 2026-08           |
| [ADR-003: SQLite on a single instance](ADR-003-sqlite-single-instance.md)                                     | stable | before 2026-08           |
| [ADR-004: One Adyen Web and one Preact](ADR-004-one-adyen-web-and-one-preact.md)                              | deprecated (ADR-014) | 2026-10-09 (Preact part) |
| [ADR-005: No Content-Security-Policy](ADR-005-no-content-security-policy.md)                                  | stable | before 2026-08           |
| [ADR-006: Adyen Web as one bundle in dev](ADR-006-adyen-web-one-bundle-in-dev.md)                             | deprecated (ADR-014) | 2026-10-09               |
| [ADR-007: Order state from authoritative events](ADR-007-order-state-from-authoritative-events.md)            | stable | 2026-10-09               |
| [ADR-008: Redirects follow the browser origin](ADR-008-redirects-follow-the-browser-origin.md)                | stable | 2026-10-09               |
| [ADR-009: No secrets in Docker images](ADR-009-no-secrets-in-images.md)                                       | stable | 2026-10-09               |
| [ADR-010: One theme attribute, two token sets](ADR-010-one-theme-attribute-and-token-sets.md)                 | stable | 2026-10-10               |
| [ADR-011: Adopt Æion Factory v1.7.0](ADR-011-adopt-aeion-factory.md)                                          | stable | 2026-10-31               |
| [ADR-012: The agentic app on Bun and Next.js](ADR-012-agentic-app-on-bun-and-next.md)                         | stable | 2026-11-15               |
| [ADR-013: Æion Template v4.0.3, no Graphify or Archify](ADR-013-aeion-template-v4-without-source-analysis.md) | stable | 2026-11-15               |
| [ADR-014: Every playground on Bun, Next.js, Elysia and Eden](ADR-014-every-playground-on-bun-and-next.md)      | stable | 2026-11-15               |
| [ADR-015: Customer accounts and agent network tokens](ADR-015-customer-accounts-and-agent-network-tokens.md)  | stable | 2026-11-17               |
| [ADR-016: A client assertion's aud may be the token endpoint](ADR-016-client-assertion-audience-for-mcp-clients.md) | stable | 2026-11-18               |
| [ADR-017: MCP Apps UI on the UCP MCP server](ADR-017-mcp-apps-ui-on-the-ucp-server.md) | stable | 2026-11-18               |

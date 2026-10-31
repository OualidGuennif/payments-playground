---
type: Decision
title: "ADR-005: No Content-Security-Policy on the playgrounds"
description: "The apps send security headers but deliberately no CSP, because it kept blocking legitimate Adyen and wallet subresources and was not the PCI boundary."
tags: [decision, security, headers]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: headers
    resource: ../../packages/platform/security.ts
    title: applySecurityHeaders and its comment
---

# ADR-005: No Content-Security-Policy

**Context.** A CSP kept blocking Adyen and wallet resources one host at a time (icons, wallet SDKs,
3DS), each time breaking a flow until someone noticed.

**Decision.** Send `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin-allow-popups`, and no CSP. Card
data lives in Adyen-hosted iframes, which remain the real PCI boundary whatever the page CSP.

**Consequences.** A merchant copying this setup must add a CSP of their own; Adyen documents the
hosts it needs. Adyen Web 6.45 added CSP nonce support for Google Pay, should one be reintroduced.

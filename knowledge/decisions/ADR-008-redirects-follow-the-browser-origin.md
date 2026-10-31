---
type: Decision
title: "ADR-008: returnUrl and the 3DS origin follow the browser's same-host origin"
description: "returnUrl and the /payments origin use the request's Origin header when it is the app's own host, falling back to PUBLIC_ORIGIN, so redirects work on any local port."
tags: [decision, redirects, 3ds, origin]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: security
    resource: ../../packages/platform/security.ts
    title: requestOrigin
  - id: tests
    resource: ../../packages/platform/security.test.ts
    title: requestOrigin tests
---

# ADR-008: Redirects follow the browser's same-host origin

**Context.** The same app is reached on 8001 (`dev:digital`), 5173 (`deno task dev`), a tunnel or
its production domain, while `PUBLIC_ORIGIN` is one fixed value. On 2026-10-09 a payment made from
`localhost:5173` sent `returnUrl` and `origin` as `http://127.0.0.1:8001`: every redirect method
would have returned the shopper to a dead page.

**Decision.** `requestOrigin(request, PUBLIC_ORIGIN)` returns the Origin header's origin when its
host is one the CSRF check already accepts (forwarded host, host, request URL or `PUBLIC_ORIGIN`),
otherwise `PUBLIC_ORIGIN`. `/sessions`, `/payments` and `/paymentLinks` use it.

**Consequences.** `PUBLIC_ORIGIN` still anchors the webhook URL and is the fallback for calls
without an Origin. A foreign Origin can never steer a redirect.

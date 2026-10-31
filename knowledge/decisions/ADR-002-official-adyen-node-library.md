---
type: Decision
title: "ADR-002: Call Adyen through the official Node library, not fetch"
description: "Server calls use @adyen/api-library's HttpURLConnectionClient so headers, idempotency, redirects and error shapes come from Adyen, with two Deno workarounds kept in one file."
tags: [decision, adyen, server]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: client
    resource: ../../packages/platform/adyen.ts
    title: The wrapper and its Deno workarounds
  - id: tests
    resource: ../../packages/platform/adyen.test.ts
    title: Endpoint, method, params and error mapping tests
---

# ADR-002: Call Adyen through the official Node library

**Context.** An earlier attempt abandoned the library for bare `fetch` after requests hung silently.
The cause was Deno's `node:http` before 2.8.0: `flushHeaders()` froze the request and `res.complete`
was never set.

**Decision.** Keep the library (v32): it supplies `X-API-Key`, idempotency keys, user agent and
`adyen-library-*` headers, follows 308s and parses Adyen's error shapes. The two Deno workarounds
live in `adyen.ts` only; they are harmless on Deno 2.9.4 (the pinned runtime) and keep older local
runtimes working. Calls go through `HttpURLConnectionClient.request` directly so the endpoint,
method and body stay explicit per call.

**Consequences.** Library quirks apply: a query string written into the endpoint is dropped (only
`url.pathname` is used), so query parameters go through `params`. Tests replace the transport to
inspect each request without network.

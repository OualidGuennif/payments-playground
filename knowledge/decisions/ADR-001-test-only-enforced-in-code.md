---
type: Decision
title: "ADR-001: TEST only, enforced in code"
description: "LIVE endpoints and non-test_ client keys are rejected by the code itself, before any request is built, not left to configuration discipline."
tags: [decision, security, test-only]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: guard
    resource: ../../packages/platform/test-only.ts
    title: assertTestOnly and profileIsTestOnly
  - id: client
    resource: ../../packages/platform/adyen.ts
    title: Every request passes assertTestOnly
---

# ADR-001: TEST only, enforced in code

**Context.** These are public playgrounds that people fork. A LIVE key pasted by mistake would turn
a demo into real money movement.

**Decision.** `assertTestOnly` rejects any endpoint on a
`(checkout|pal|device-api|terminal-api)-live` host, any environment other than `test`, and any
client key starting with `live_`. `profileIsTestOnly` runs on every profile, including those added
in Settings. The browser only ever receives a client key that starts with `test_`. The UI carries a
permanent TEST marker (a header pill since
[ADR-010](ADR-010-one-theme-attribute-and-token-sets.md)).

**Consequences.** There is no switch to point the code at LIVE, and none must be added. The guard is
a seatbelt, not a policy: [SECURITY.md](../../docs/SECURITY.md) still tells forkers never to use
LIVE credentials.

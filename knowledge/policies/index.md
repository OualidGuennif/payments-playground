---
type: Reference
title: Policies index
description: "Durable rules for changing and verifying this repository."
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
---

# Policies

| Concept                                                     | Status     | Notes                                               |
| ----------------------------------------------------------- | ---------- | --------------------------------------------------- |
| [Engineering](engineering.md)                               | stable     | Discipline, conventions, commits, DO-NOT list, done |
| [Verification and reporting](verification-and-reporting.md) | stable     | Evidence ladder, statuses, report sections          |
| [Security](security.md)                                     | stable     | Secrets, input, access boundaries, scans            |
| [Specs first](specs-first.md)                               | stable     | Eight component sections, doc-to-code links         |
| [Repository organization](repo-organization.md)             | stable     | Role-named folders, one home per concern            |
| [UI and UX](ui-ux.md)                                       | stable     | Tokens, contrast, phone first, truthfulness         |
| [Bounded intake](bounded-intake.md)                         | stable     | Targeted reads and summary commands                 |
| [Owner preferences](owner-preferences.md)                   | stable     | Render root, TEST only, scope, toolchain, pi        |
| [Engineering rules (deprecated)](engineering-rules.md)      | deprecated | Superseded by `engineering.md`                      |

The security model (what stays on the server, card data, controls, what is not protected) is the
public [SECURITY.md](../../docs/SECURITY.md); the TEST-only rule is
[ADR-001](../decisions/ADR-001-test-only-enforced-in-code.md).

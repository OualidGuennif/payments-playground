---
type: Policy
title: "Verification levels, statuses and what a report must contain"
description: "The cumulative evidence ladder from CODE VERIFIED to DEPLOYED VERIFIED, the PASS/FAIL/PARTIAL/NOT_OBSERVED/OWNER_ACTION_REQUIRED vocabulary, and the sections of a final report."
tags: [policy, verification, reporting]
status: stable
scope: verification-and-reporting
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: oualstreet
    resource: git-history:knowledge/operations/reporting-and-confidence-levels.md
    title: "Adapted from the owner's Oualstreet confidence levels (separate repository)"
  - id: check
    resource: deno.json
    title: The check task behind CODE VERIFIED
---

# Verification and reporting

## Levels (cumulative)

| Level                 | Means                                                                     | Typical evidence                                    |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| **CODE VERIFIED**     | `deno task check` passes, including tests that pin the behaviour          | test names, task output                             |
| **TEST API VERIFIED** | A real Adyen TEST call answered as expected                               | the `api_calls` row: status, `resultCode`, PSP ref  |
| **BROWSER VERIFIED**  | The flow completed in a real browser against the dev or built server      | screenshot, DOM state, the order row it produced    |
| **WEBHOOK VERIFIED**  | A notification with a valid HMAC was processed and changed what it should | `webhooks.hmac_valid = 1`, the order state after    |
| **DEPLOYED VERIFIED** | The same behaviour observed on the Render deployment                      | `/api/health` versions, a flow on the public origin |

A level is never claimed from the one below it. A build is not a payment; an accepted capture
(`status: received`) is not a captured payment; a simulated notification signed with the local key
is not Adyen's delivery. Say which one you have.

Browser-specific problems need the browser in question: an ad blocker or a Firefox-only failure is
not reproduced in Chromium. Headless Firefox with a request intercept is an acceptable stand-in; the
owner's own browser is the final word.

## Statuses

`PASS`, `FAIL`, `PARTIAL`, `NOT_OBSERVED` (not exercised), `OWNER_ACTION_REQUIRED` (needs the owner:
a Customer Area setting, a browser extension, a credential). "Probably works" is not a status. Every
`PASS` names its evidence.

## A final report says

BEFORE, AFTER, TESTS RUN, RUNTIME EVIDENCE (with level), REMAINING GAPS, OWNER ACTIONS. Durable
facts from it go into `knowledge/current/`, with the date and the level reached.

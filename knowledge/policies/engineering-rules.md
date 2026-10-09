---
type: Policy
title: "Engineering rules: how code is changed in this repository"
description: "The discipline before changing code, the conventions code must follow, how Adyen request bodies are built, what a commit says, the DO-NOT list and the definition of done."
tags: [policy, engineering, conventions]
status: stable
scope: engineering-rules
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: fmt-lint
    resource: deno.json
    title: fmt (line width 100, double quotes, semicolons), lint (fresh + recommended), tasks
  - id: oualstreet
    resource: git-history:knowledge/policies/engineering-discipline.md
    title: "Adapted from the owner's Oualstreet engineering discipline (separate repository)"
---

# Engineering rules

## Before changing anything

1. Locate the current authority: which module owns the behaviour (often `packages/platform`, not the
   app). Read its wiring and its tests.
2. Reproduce the problem with evidence (a request log, a HAR, a failing test, a DB row) before
   proposing a cause. Do not guess from symptoms.
3. Change the minimum that closes a real, proven gap. Do not redesign a working component because
   another shape looks nicer, and do not build a parallel path next to an existing one.

## Conventions

- Deno 2, TypeScript, Preact. `deno fmt` (line width 100, double quotes, semicolons) and `deno lint`
  are law; `deno task check` must stay green.
- Comments say **why**: the Adyen behaviour, the failure that happened, the constraint. Never what
  the next line does. Match the density of the surrounding code.
- Names and copy are plain and specific. English only, in code, comments, tests, docs, commits.
- Logic a second app could use goes in `packages/platform` with a test beside it; `api.ts` stays
  glue. A pure decision (state, permission, origin) is a pure function with unit tests.
- Money is an integer in minor units; display goes through `formatMinorAmount` (currency exponent
  aware).
- Every Checkout endpoint gets its own request body. Never forward `state.data` wholesale; add a
  field only after checking it in the `@adyen/api-library` request typings, because `/sessions`,
  `/payments` and `/paymentLinks` reject unknown fields
  ([notes](../references/adyen-checkout-api-notes.md)).
- Secrets stay server-side. Anything under `islands/` is public.

## Commits

One concern per commit. The subject says the outcome in the imperative ("Record how every digital
payment actually ends"). The body says what was wrong, why, what changed and how it was verified,
with evidence. No session narratives in files: durable facts go into `knowledge/`, task state into
`work/current.md`, the rest into the commit message.

## DO-NOT list

- Do not point anything at LIVE, add a LIVE switch, or weaken `test-only.ts`.
- Do not weaken, skip or delete a test or an invariant to get green. The styling token audit failing
  after an SDK bump is the point.
- Do not commit `.env`, `.env.local`, SQLite files or anything under `data/`.
- Do not put a credential in a log, a URL, a commit, a doc or a chat message.
- Do not claim a flow works without evidence at the right level
  ([verification](verification-and-reporting.md)).
- Do not rewrite `deno.lock` wholesale for a targeted upgrade; keep its diff to the packages that
  changed.

## Definition of done

- `deno task check` passes (format, lint, knowledge check, types, tests, four builds, SSR
  assertions).
- The behaviour is verified at the level the change needs, with the evidence written down.
- Every knowledge concept whose facts changed is updated in the same change, with `generated.at`
  bumped and `verified` added only for checks actually performed.
- `work/current.md` is updated or cleared.

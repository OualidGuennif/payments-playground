# Payments Playground: agent instructions

Four Adyen **TEST** playgrounds in one Deno workspace (Fresh 2 + Hono, Adyen Web 6.47.0, Checkout
API v72). Current focus: `apps/adyen-digital`. Owner and final say: Oualid (OualidGuennif).

Read this file in full; it is short on purpose. Everything else is in `knowledge/`, loaded
progressively: start at [knowledge/index.md](knowledge/index.md) and open only what your task needs.

## Repository map

```
apps/adyen-digital/          online checkout + Back Office (focus, Ready)
apps/adyen-v6-styling/       Drop-in theming workbench (Ready)
apps/adyen-ipp-endless-aisle/, apps/adyen-agentic-commerce/   in progress
apps/landing/                static front door
packages/platform/           server only: Adyen client, SQLite, security, state machine
packages/ui/                 browser-safe: components, tokens, Adyen Web configuration
scripts/                     dev/build orchestration, Vite plugins, knowledge-check
knowledge/                   canonical knowledge (OKF v0.2)
work/current.md              current task state, not permanent knowledge
docs/                        public SECURITY.md and KNOWN_LIMITS.md
```

## Build and test

```bash
deno task check                      # fmt, lint, knowledge, types, tests, 4 builds, SSR asserts
deno task --cwd apps/adyen-digital dev   # dev server on :5173 (dev:digital uses :8001)
```

There is no CI: `deno task check` before every push is the gate. Runbooks:
[knowledge/operations/index.md](knowledge/operations/index.md).

## Rules that are never negotiable

1. TEST only. Never add a LIVE path or weaken `packages/platform/test-only.ts`.
2. Secrets stay server-side and out of git, logs, images, URLs and chat. Anything under `islands/`
   is public.
3. Never forward Adyen Web `state.data` wholesale: add a field to a request only after checking it
   in the `@adyen/api-library` typings. Endpoints reject unknown fields.
4. An order's state comes from Adyen's answers and HMAC-valid webhooks, never from the browser. A
   refusal ends an attempt, not an order.
5. Never weaken a test or an invariant to get green.
6. Locate the authority, reproduce with evidence, change the minimum.
7. English only: code, comments, tests, docs, commits. Comments say why, not what.
8. Claim a result only at the verification level you reached, with evidence:
   [knowledge/policies/verification-and-reporting.md](knowledge/policies/verification-and-reporting.md).
9. Full rules and the DO-NOT list:
   [knowledge/policies/engineering-rules.md](knowledge/policies/engineering-rules.md).

## Recovery after compaction or unfamiliar files

Do not assume unfamiliar changes are yours from a lost context. Run `git status --short` and
`git log -5 --oneline`, re-read this file and `knowledge/index.md`, read `work/current.md`, then
inspect the actual diff. If a file's origin is unclear, say so and do not overwrite it.

## Definition of done

- `deno task check` passes.
- The behaviour is verified at the level the change needs, evidence written down.
- Every knowledge concept whose facts changed is updated in the same change (`generated.at` bumped,
  `verified` only for checks actually performed).
- `work/current.md` is updated or cleared.

## What not to do

- Do not append session summaries or narratives to this file. Durable facts go to `knowledge/`, task
  state to `work/current.md`, the rest to commit messages.
- Do not create an independent copy of this file: `CLAUDE.md` is a symlink to it.

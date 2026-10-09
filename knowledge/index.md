---
okf_version: "0.2"
---

# Payments Playground knowledge base

Four Adyen TEST playgrounds in one Deno workspace: Fresh 2 pages, a Hono API in the same process,
Adyen Web 6.46.0 in the browser, Checkout API v72 on the server. Current focus: `adyen-digital`.
This bundle is the canonical engineering knowledge. Open only what your task needs.

| Area                                | One line                                                                   | Start with                                     |
| ----------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Understand the system               | Apps and packages, the payment lifecycle, the data model, the dev pipeline | [architecture/index.md](architecture/index.md) |
| Change a component                  | What each app and package owns, its routes and endpoints                   | [components/index.md](components/index.md)     |
| Understand why a choice exists      | One ADR per durable decision                                               | [decisions/index.md](decisions/index.md)       |
| Follow a rule                       | Engineering rules, the DO-NOT list, the verification vocabulary            | [policies/index.md](policies/index.md)         |
| Do something                        | Build, test, run locally, replay webhooks, ship, upgrade Adyen Web         | [operations/index.md](operations/index.md)     |
| Check what is verified right now    | Dated, evidence-backed state of `adyen-digital`. **Check `stale_after`.**  | [current/index.md](current/index.md)           |
| Adyen behaviour this repo relies on | Checkout API and Adyen Web facts learned the hard way, the OKF spec        | [references/index.md](references/index.md)     |
| Look up a term                      | Short definitions                                                          | [glossary/index.md](glossary/index.md)         |

## How this bundle is organised

- Every concept is Markdown with YAML frontmatter: `type`, `title`, `description`, `status`
  (`draft`, `stable` or `deprecated`), `generated` (`by`, `at`) and `sources`. Factual and normative
  types (Architecture, Component, Decision, Policy, Runbook, Current State) must cite sources, and a
  source that is a repository path must still exist.
- Local extensions: `stale_after` (after this date the concept must be re-verified, or marked STALE
  at the top), `verified` (checks actually performed, dated), `scope` (at most one stable concept
  per scope), `superseded_by`.
- `deno task knowledge:check` validates the bundle, `AGENTS.md` and its `CLAUDE.md` symlink. It runs
  inside `deno task check`.

## What is not here

- Public, human-facing documents stay where readers and GitHub look for them: the
  [README](../README.md), [SECURITY.md](../docs/SECURITY.md) (threat model and controls) and
  [KNOWN_LIMITS.md](../docs/KNOWN_LIMITS.md) (what is simulated or not done). Concepts link to them
  rather than copy them.
- Ongoing task state lives in [work/current.md](../work/current.md), not here.
- Change history is `git log`. It is not retold as prose.

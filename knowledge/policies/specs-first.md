---
type: Policy
title: "Specs first, and links to code"
description: "The OKF format: the eight sections a component doc carries as its spec, the determinism slider, decisions, the optional framework mode, and the two-way links between docs and code that the checks enforce."
status: stable
generated:
  by: aeion-template/4.0.3
  at: 2026-11-15T18:00:00Z
sources:
  - id: tool
    resource: ../../tools/knowledge/doc-links
    title: "The link checker"
  - resource: ../../tools/knowledge/knowledge-check
    title: "knowledge-check, which names this doc as its spec"
---

# Specs first

The spec is the source of truth; the code implements it. A component doc, and any new feature before
its code is written, has these sections in this order:

```text
## Intent              one or two sentences: what it is for, which decision it serves
## Data sources        | Source | What is read | Owner | Freshness |
## Inputs              exact structure: types, fields, units, allowed values; a link to the type
## Outputs             exact structure, plus every refusal and error code
## Invariants          numbered; each names the test that proves it
## Determinism         deterministic | bounded | adaptive, and why
## Acceptance checks   commands that pass or fail
## Out of scope        what it does not do, one line each
```

| Level         | Who produces the output                | How it is checked                               |
| ------------- | -------------------------------------- | ----------------------------------------------- |
| deterministic | code                                   | unit and parity tests                           |
| bounded       | a model, under a fixed output contract | a strict parser; unreadable output is a refusal |
| adaptive      | a model, free text                     | never an authority: advice or a report          |

# Where the spec lives

The component doc is the spec: its eight sections are the contract the code implements, and
`tools/knowledge/knowledge-check` refuses a component doc without them. This is the OKF format the
whole knowledge base follows: frontmatter that `knowledge-check` caps, the eight sections, and links
that run both ways between docs and code (below).

- **Order of work.** A behaviour change starts in the doc (intent, outputs and refusals, invariants
  with the test that proves each), then the test, then the code. An internal change that alters no
  documented fact needs no doc change, and says so with a `Docs-Checked` trailer.
- **Decisions.** A choice with more than one defensible answer gets a record in
  `knowledge/decisions/` before the code that depends on it.
- **Framework mode (optional, off here).** A project specified with aeion-framework keeps its
  requirements in the AxiomSpec the framework serves; code names them with `@req REQ-001` and the
  agent reads them through the framework API. This project sets no framework address
  ([ADR-013](../decisions/ADR-013-aeion-template-v4-without-source-analysis.md)).

# Links between docs and code

- **Datation:** a volatile document may carry `review_after: YYYY-MM-DD` in its frontmatter;
  `tools/knowledge/stale` fails once the date passed, and a document without the key is exempt. A
  present key must hold a real, nonempty date; a blank value is invalid, not an exemption.
- **Doc to code:** the doc's frontmatter `sources` lists the files it describes
  (`resource: ../../src/area/file.ts`). A directory source is checked for existence only.
- **Code to doc:** a described file carries one header line `Spec: knowledge/<doc>.md`, and that doc
  lists the file (or a folder holding it) in its `sources`: the contract runs both ways (L4).
- `tools/knowledge/doc-links` fails when a pointer or a source does not resolve, when a `Spec:`
  doc's sources omit the file that names it, and with `--diff origin/develop` (or `origin/main`
  without develop) when a file changed while a doc covering it did not. Updating the doc, or a
  commit trailer `Docs-Checked: knowledge/<doc>.md -- <why no documented fact changed>`, passes.
- A link is a pointer, never copied content.
- The same links decide what an agent reads first: the [doc gate](../components/doc-gate.md) refuses
  an edit of a covered file until each covering doc was read in the session (the owner can set it to
  `warn` or `off`).
- Git enumeration, history and diff failures return nonzero with a short diagnostic. An unreadable
  repository (a `.git` git cannot read) or missing comparison base is not an empty change set and
  never produces PASS. A plain folder without git is walked from disk (L1, L2 and L4; `--diff` needs
  git).
- A project nested in this one (a folder with its own `AGENTS.md` and `knowledge/index.md`) owns its
  `Spec:` pointers: they name its own `knowledge/`, so this root skips its files in L1 and L3, and
  the nested project's own `doc-links` checks them. A folder release archives leave out
  (`/name export-ignore`) is treated the same way.
- Paths are read from Git (or the disk walk) verbatim, including spaces and Unicode. Explicit
  relative `sources` work for any file format; only a path beginning with `./` or `../` may contain
  whitespace.
- Header discovery reads at most 8 KiB of leading comments/docstrings in tracked regular UTF-8 text
  files, regardless of suffix. It excludes Markdown, `knowledge/`, vendored/dependency/cache folders
  and secret paths (the shared list in `.claude/hooks/secret_names.py`). It never follows file
  symlinks. Use explicit sources for other formats or metadata after executable code; directory
  sources remain existence-only.
- A documentation-only exemption accepts standalone comment `Spec:` lines and blanks, never
  executable code that happens to contain a pointer.

Diff coverage retains bounded `Spec:` headers from the merge base for deleted files and removed
pointers. Removing an implementation/header does not silently remove its documentation duty.
`Docs-Checked` exemptions require the complete `Docs-Checked: knowledge/<doc>.md -- <reason>` line
with a nonempty explanation; review still verifies whether that explanation is truthful.

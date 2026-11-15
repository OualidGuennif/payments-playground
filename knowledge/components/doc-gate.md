---
type: Component
title: "Doc gate"
description: "The docs a file names or is named by are read in the session before the file is edited; enforce by default, warn or off by the owner's choice."
status: draft
generated:
  by: aeion-template/4.0
  at: 2026-11-12
verified:
  - at: 2026-11-12
    what: "tools/framework/tests/test_axiom_api.py: 16 passed; shell reads load briefs, retain unserved refusals and share the eight-ID cap"
sources:
  - id: gate
    resource: ../../.claude/hooks/doc-gate.py
    title: "The doc gate hook"
  - id: lookup
    resource: ../../tools/knowledge/doc-links
    title: "doc-links --for, the coverage lookup the gate reuses"
  - id: adapter
    resource: ../../tools/agents/hook.py
    title: "The shared adapter that runs the gate for the other harnesses"
---

# Doc gate

## Intent

The references in the code decide what an agent reads before it edits. A file that names its spec
(`Spec: knowledge/<doc>.md`), or that a doc lists in its `sources`, is edited only after that doc
was read in the same session. The after-edit hint said "update the doc" once the edit was done; the
gate asks for the reading before it, when the doc can still shape the change.

## Data sources

| Source                                     | What is read                                                                                                    | Owner                                 | Freshness                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `tools/knowledge/doc-links --for FILE`     | the docs covering an existing file: its `Spec:` header and the docs naming it in `sources` (files, not folders) | knowledge/ and the code               | each gated edit                                                   |
| a Write's `content`                        | `Spec: knowledge/<doc>.md` in its first 30 lines, for a file that does not exist yet                            | the agent                             | each Write                                                        |
| `<tmp>/claude-doc-read-<session>`          | the docs this session read or wrote                                                                             | this hook                             | each event                                                        |
| `.aeion/settings.json` `doc_gate`          | `enforce` (default), `warn` or `off` ([framework mode](framework-mode.md))                                      | the owner                             | each event                                                        |
| the file's `@req` IDs, framework mode only | the requirements whose briefs must have loaded (`axiom:<ID>` in the read set)                                   | the code; the aeion-framework service | each gated edit; each native or shell read of the file loads them |

## Inputs

- **SessionStart** from a compaction, a resume or a clear (any source but `startup`): the read set
  and the warned set are forgotten, since the agent no longer holds the text it read. A startup
  keeps them: a new session already has its own empty set, and OpenCode sends a startup before every
  prompt.
- **PostToolUse Read** of a `.md` file inside the project: recorded as read, whatever the range.
- **PostToolUse Bash**: a `.md` path given to `cat`, `head`, `tail`, `sed`, `less`, `more`, `bat` or
  `nl` is recorded, so a harness that reads through its shell (Codex) passes the gate the same way.
  In framework mode, code paths given to those readers load their `@req` briefs as a native Read
  does, using the tool's declared working directory. A multi-file command shares the eight-ID cap
  and two-and-a-half-second deadline; another read loads any remaining IDs.
- **PostToolUse Edit, MultiEdit, Write, NotebookEdit** of a `.md` file: recorded, the agent wrote
  it.
- **PreToolUse Edit, MultiEdit, Write, NotebookEdit** (`apply_patch` through the adapter, once per
  path).

## Outputs

- `enforce`: exit 2 before the edit, naming each unread doc, how to read it, and the owner's switch:
  `tools/aeion-settings doc-gate warn|off`. The edit goes through once every covering doc is read.
  In framework mode it also names the `@req` IDs whose briefs have not loaded, and asks for the file
  to be read again: that read loads them ([framework mode](framework-mode.md)).
- `warn`: the edit goes through; after it, one line of context per file and session names the unread
  docs.
- `off`: silent.
- Never gated: a file outside the project, `knowledge/`, `work/`, any `.md` file, and a file no doc
  covers.
- `enforce` refuses when the coverage cannot be listed (`doc-links` missing, failing or slower than
  two seconds) or the session has no valid identifier: uncertain is no.

## Invariants

1. A covered file is never edited in `enforce` before each covering doc was read in this session.
2. A compaction or a resume the harness reports empties the read set, so the doc is read again.
3. Docs, `knowledge/` and `work/` are never gated, so writing the spec first is always possible.
4. `warn` and `off` never refuse.
5. Every harness can satisfy the gate: each reports its read tool or its shell to the adapter.

| Invariant         | Test                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 3, 4           | `.claude/hooks/test_hooks.py` (`doc gate` cases)                                                                                                                                                          |
| 2                 | `.claude/hooks/test_hooks.py` (`doc gate forgets at session start`)                                                                                                                                       |
| 5                 | `tools/agents/tests/test_hooks.py` (the gate through the adapter: Read, shell read, apply_patch)                                                                                                          |
| 5, framework mode | `tools/framework/tests/test_axiom_api.py` (`test_shell_reads_load_briefs_before_an_edit`, `test_shell_reads_keep_unserved_requirements_closed`, `test_a_shell_read_shares_the_brief_budget_across_files`) |

## Determinism

Deterministic for one set of docs and one session: the lookup is `doc-links --for`, which answers in
about a tenth of a second on this repository, inside the hook's three seconds; no index is kept.

## Acceptance checks

- In a Claude Code session, an Edit of `.claude/hooks/guard-bash.py` before reading its docs is
  refused with `knowledge/policies/security.md` named; after reading both docs it goes through.
- With `tools/aeion-settings doc-gate warn`, the same edit goes through with one line naming the
  docs.
- After `/compact`, the same edit is refused again until the docs are read again.

## Out of scope

- Shell writes (`sed -i`, a redirection): the gate covers the native edit tools, as after-edit does.
  It guides the agent; it is not a security boundary.
- Folder sources: `doc-links` gives coverage only for exact files, so a new file in a documented
  folder is gated only by the `Spec:` header it carries.
- Whether the doc was understood, or read whole: a range read counts, as bounded intake asks for
  ranges.
- Shell expansion or a `cd` inside a command: only literal paths and the tool's declared working
  directory are used.

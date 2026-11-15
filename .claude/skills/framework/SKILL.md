---
name: framework
description: Works with a project specified in aeion-framework's AxiomSpec when framework mode is on - reads what a requirement demands and what binds it through tools/framework/axiom-api before planning or changing behavior, keeps the @req annotations true, never edits requirements and writes disagreements to axiom-proposals.md. Use when session start says framework is on, or the code carries @req IDs.
---

# Framework

## Overview
In framework mode the requirements live in an aeion-framework service, not in `knowledge/`. The
component docs explain how the code works; the service says what it must do. Rules:
`knowledge/components/framework-mode.md`, and the framework's agent protocol (playbook 03).

## When to use
Session start prints `framework: on → <address>`, or reading a file loads `AxiomSpec briefs`. With
`framework: off`, and `@req` IDs in the code, the owner connects it (`tools/aeion-settings framework`);
never connect it, or change the doc gate, yourself.

## Process
1. Find the requirements a change touches: the briefs a Read of the file loads, or
   `tools/framework/axiom-api trace --path <file>` (or `--symbol <name>`).
2. What one demands: `tools/framework/axiom-api node <ID>`. What binds it:
   `tools/framework/axiom-api context <ID>[,<ID>…]`.
3. Before changing behavior: `tools/framework/axiom-api context <IDs> --scope change`, and continue
   with the `more:` command it prints until `complete` is true. Put the IDs in the plan.
4. Implement. Annotate the code that implements a requirement with a comment holding `@req` and its
   IDs on one line; keep every annotation true to the code you leave.
5. A requirement that looks wrong, or two that conflict: do not work around it. Write the problem,
   where you saw it and what you propose to `axiom-proposals.md` at the root, and stop that part.
6. Before sign-off: `tools/framework/axiom-api gaps --phase implementation` names what lost its
   place in the code. Report it; it is advice, the specification's tests decide.

## Rationalizations
| Excuse | Rebuttal |
| --- | --- |
| "The brief is enough for this change" | A brief says what one requirement demands; a behavior change needs the change scope, every page. |
| "I can fix the requirement myself" | Requirements change through the framework's own review; the agent proposes. |

## Red flags
An edit refused for unloaded briefs and worked around through the shell; a `@req` that names an ID the
code no longer implements; a change scope read without its last page.

## Verification
- [ ] The plan names the requirement IDs and the change scope was read to `complete: true`.
- [ ] Every `@req` added or kept matches the code beside it.
- [ ] Disagreements are in `axiom-proposals.md`, none worked around.
- [ ] `gaps --phase implementation` was run and reported.

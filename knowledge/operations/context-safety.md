---
type: Runbook
title: "Context safety and handover"
description: "One 340k/390k rule for Claude, Codex, OpenCode, Pi, dsh, Grok and Droid: closure, verified handover, compaction, and its limits."
status: stable
review_after: 2027-01-29
generated:
  by: aeion-template/1.1
  at: 2026-11-27T11:32:00Z
verified:
  - at: 2026-11-27
    what: "tools/template-tests PASS after the Droid patch merge; test_budget.py: a commit of verified docs keeps the receipt, closure commits staged docs only, a handover over 32 KiB is refused"
  - at: 2026-11-27
    what: "tools/template-tests PASS; test_budget.py covers the 300k notice, closure reads, pruning and a behind handover; work/handovers/ held 20 files before and after the run"
  - at: 2026-11-24
    what: "tools/agents/tests/test_hooks.py: 74 passed; a live Droid transcript showed two native compactions at 355k after the 340k alerts while Droid's meter read 338%; a Droid epoch admits 4 image reads"
sources:
  - id: budget
    resource: ../../tools/context/budget.py
    title: "Budget state and documentation checkpoint"
  - id: hook
    resource: ../../.claude/hooks/context-budget.py
    title: "Claude hook adapter"
  - id: settings
    resource: ../../.claude/settings.json
    title: "Default registrations and compaction window"
  - id: tests
    resource: ../../tools/context/tests/test_budget.py
    title: "Boundary and failure regressions"
  - id: adapters
    resource: ../../tools/agents/hook.py
    title: "Codex, OpenCode and Pi usage readers"
  - id: launcher
    resource: ../../tools/context/run
    title: "Managed launch and unsupported strict refusal"
  - id: handovers
    resource: ../../.claude/hooks/handovers.py
    title: "Handover skeleton, pruning and staleness"
  - id: leak-guard
    resource: ../../tools/agents/tests/leak-guard.mjs
    title: "Adapter suites leave no handover behind"
---

# Context safety

[Bounded intake](../policies/bounded-intake.md) reduces obvious large Read/Grep/Bash dumps before
execution. Intake bounds are not output virtualization: no tool result is rewritten, and these
heuristics cannot establish an absolute context ceiling. Keep targeted reads and summary commands.

The default Claude profile enables native auto-compaction at 340,000 tokens and a budget hook
on session start, prompts, tools, compaction and stop (the same `.claude/settings.json` also denies
Read of the credential stores, see [security](../policies/security.md)); `tools/context/run` names a missing `claude`
in one line instead of a traceback. SubagentStop also checks a child's final
observation, including pure-text child responses. The hook reads only the current session's
bounded transcript tail and retains native token counts, never transcript text. Cached input
counts once. Synthetic assistant records (API errors and hook stops, model `<synthetic>`) were
never sent and are skipped, so a stop cannot hide the last real request and block every later
prompt. After a "prompt is too long" error the real context may exceed that last observation; the
request itself still fails natively. Missing or zero usage is unavailable, not an empty context. A Grok envelope is not a Claude
transcript: `hookEventName` in snake_case, or a transcript named `updates.jsonl` or `chat_history.jsonl`, makes `handle`
return an empty object and write no state, so the first Grok prompt cannot latch STOPPED. The Grok
adapter reads `contextTokensUsed` from `signals.json` beside that transcript. That figure is the live window and falls after compaction. `usage.json` beside it is the billed ledger and only grows, so it is not the context size. A zero window is a real reading. An incomplete final JSONL line is
a transient write; a malformed complete record is invalid.

Every event latches the first observed 340k crossing, including PreCompact. The hook alerts both
agent and user at the next supported event; PreCompact retains a pending alert because that event
discards system messages. A harness that compacts without the adapter seeing its compact SessionStart
(dsh does) would otherwise keep the latch forever: an observed size back under the threshold ends it,
and the closure it owed survives as `closure_owed`, which the settlement still enforces. The debt
never re-latches a later fall: a session that climbs over 340k again and compacts again is released
again, because Stop enforces the debt while the threshold no longer justifies the gate. A latch a
harness set because its own compaction resumed it in closure (Codex, Droid) is the exception:
`resumed_in_closure` keeps it latched until the handover verifies. PreCompact refuses an absent
checkpoint, and a stale one whose handover is incomplete; a complete handover that was verified before
the tree moved still compacts, and owes `closure_owed` until a fresh receipt, because the gate admits
only the checkpoint command that could refresh it. Only closure work
(reads, docs/task/handover edits and fixed verification commands) remains available. A harness tool that
acts only through calls the gate judges one by one passes too, when its adapter marks it
(`closure_safe`): Droid's `Script`, with `WaitForScript` and `TodoWrite`; a subagent (`Task`) stays
closed. Without that mark a Droid session whose tools all run inside `Script` could not even write
its handover. Droid keeps a verified 340k handover until its compaction (owner decision 2026-11-27):
the receipt records the closure it was taken in, and once it verifies, a later edit (this session's or
another session's in the same clone) no longer freezes code again. That compaction owes no closure,
and its compact SessionStart names the files changed since the receipt. Droid compacts natively 15k
later (355k), so the handover drifts little; 390k keeps the strict receipt. At an observed
390k closure keeps exactly that set (code stays frozen): the checkpoint runs `doc-links --diff`
and, in the team flow, requires `work/current.md`, so narrowing it to the handover left a doc a check
named unrepairable before compaction. Stop is refused, and the message asks for the handover and
compaction now. 390k never stops the run: once the checkpoint is
verified, compaction runs again and the session continues from its handover. A failing check does not
recreate that stop at 390k: code is frozen there, so a check that failed before the session could be
neither verified nor repaired. At 390k the hook signals the adapters to compact whether or not the
checkpoint verifies, lets that compaction through, records that the closure is still owed
(`closure_owed`), and admits code edits in the new epoch with a warning that names the checkpoint
command; Stop stays refused until a verified receipt settles the debt on the next event that reads the
receipt. That settlement keeps the receipt while the session is still at or above 340k: the same event
re-latches the alert, and dropping the receipt would close the gate before the compaction it owes.
Codex and Droid keep their own early-compaction path, which still resumes in closure; a Pi
compaction the checkpoint did not verify runs too, resumes editable and owes its receipt, because
freezing code over a check that already failed is the deadlock the stopgap exists to prevent. Below
390k the refusal is unchanged, so a session that must repair code compacts at 390k. The checkpoint
itself is not weakened: it still runs every check over the whole tree and refuses on any failure. The
session state and active handover survive restart. Each session has its own file lock and atomic state.
Tool events carrying `agent_id` use a separate parent/agent key and that child's transcript,
including the documented nested `subagents/agent-<id>.jsonl` layout and a workflow's
`subagents/workflows/<run>/agent-<id>.jsonl`. Missing child usage refuses
the child; it never reads the parent's counters or changes the parent's stop state. Child
handover/checkpoint commands use the separate key printed by the guard.

Claude Code compacts natively at 340k, the same size as the alert, so there the compaction can land
right after the alert, before the handover is written. The handover is then written after it from the
harness summary, and the closure is owed (`closure_owed`) until its checkpoint passes. One live
desktop-app session in an adopting project took exactly that path on 2026-11-26 and recovered with
nothing lost. A **300k notice** therefore comes first. It is sent once per climb, at the first tool or
prompt event at or over 300k, and it refuses nothing. It creates the handover skeleton and asks for
it to be filled while the agent still holds the detail. A fall back under 300k re-arms it.

Before any compaction, fill `work/handovers/<session-id>.md`, update `work/current.md` and affected
docs, and run `python3 tools/context/budget.py checkpoint --session <id> --base <git-ref> --verify`
(`--base` only under git; a plain folder skips the diff and task-state checks). The handover records
what a compaction summary drops: the owner's rules and decisions, the exact next commands and the
evidence ids. Each skeleton section names what it wants after its `TODO:`.
The command runs knowledge/link/health checks and binds readiness to the bytes of the tree (tracked
and untracked files, ignored ones and `work/handovers/` aside) and the handover hash, never to the
commit HEAD names: committing the verified bytes, or deleting a file and committing the deletion,
keeps the receipt, so the team flow can commit its docs without re-entering closure (adopters
reported that loop). Later edits invalidate it, except for Droid's verified 340k handover (above). A refused check names the check and lists every
`RULE …`/`FAIL …` line it printed, whole and one per line (past 50 the rest are counted), so the agent
fixes them in one pass instead of retrying a bare exit status; output that names no rule keeps a
bounded tail. Compaction is
refused without a current receipt, and the refusal names the paths changed since it: a live session
log inside the tree changes on every event, so it is git-ignored or written outside
the project.
Local mode (the default: `aeion.mode` unset or not `team`, read with `--local` so includes and the
global config do not count) keeps no `work/current.md` entry, so its checkpoint
does not require one. During closure a command the shell cannot parse is denied, never a stop.
Closure admits edits to any Markdown file in the project, so a project's own docs can be updated,
and never a code file. Reads stay open, so the handover can describe live state. That covers Read,
Grep and Glob, a background task's output (`TaskOutput`, `BashOutput`) and plain `git status`, `log`,
`show` and `diff`, and the team flow's commit of its docs: `git add` of doc files (Markdown, `work/`,
the root docs; no flag, glob or folder) and `git commit -m` (or `-q`, `--message`; no `--amend`, `-a`
or hook skipping) while every staged path is one closure could edit. It also covers the browser reads of the page already open (`find`, `read_page`,
`get_page_text`, `tabs_context`, console and network reads, and `computer` screenshots and zooms). A
git read that writes a file (`--output`), runs a program (`--ext-diff`) or reads outside the repository
(`--no-index`) stays closed. So do navigation, clicks and typing. The checkpoint is admitted from any working directory when its path resolves
to this root's `budget.py` (relative to the shell's folder, absolute, or after a `cd <root> &&`
prefix), and a bare `cd <root>` is admitted; any other `cd`, chain or session is denied. The
handover has the exact lines `## Scope`, `## Completed`, `## Remaining`, `## Constraints` and
`## Evidence`; the 340k and 390k messages name the checkpoint command and those lines, and a
refused checkpoint names each missing heading and any remaining TODO. A handover over 32 KiB, or
with a line over 1,000 characters, is no checkpoint either: the next context must read it whole
under [bounded intake](../policies/bounded-intake.md)'s 64 KiB, and an adopter's grew to 70 KB. A
refused call lists what closure admits and, when a receipt exists, the paths changed since it.
The skeleton appears only when closure needs it (the 300k notice, the 340k alert, the 390k forced
closure, a refused compaction or the first checkpoint command), so ordinary sessions and subagents
leave none; replace each TODO. Keep outcomes, remaining
work, constraints and evidence concise. These local handovers are ignored by Git; durable facts
belong in Knowledge. After compaction the same file is the recovery pointer.

A handover is **behind** when HEAD or `work/current.md` moved past the checkpoint that verified its
bytes. A verified checkpoint records HEAD, `work/current.md` and the handover in the ignored
`.aeion/context/<session>-handover.json`, which outlives the compaction. Closure saves the handover
before `work/current.md`, so the save time alone would call a just-verified handover behind. A
handover edited since, or never verified, is compared by the time it was last saved instead. Session
start says so for this session's own handover, and so does the sign-off, once, at Stop. A skeleton nobody wrote into (every line under the title a
heading or a `TODO`) holds nothing. Session start deletes those older than seven days, and closure
writes a fresh one when it needs one. `repo-health` warns, and never fails, past 20 of them. The
adapter test suites remove what their own sessions write and fail on any other new skeleton
([leak guard](../../tools/agents/tests/leak-guard.mjs)).

Startup and the first prompt allow a native bootstrap before usage exists. All later work
requires a positive native observation. A bounded retry waits for asynchronous transcript writes;
unavailable usage denies the current tool call (the agent keeps running and may retry it;
PostToolUse passes; other events stop) without latching STOPPED, so a later valid observation
can recover. A PostToolUse warning from the prompt-defense scan travels in the same assistant
context and changes no budget decision. Invalid complete records remain terminal: that is an
integrity failure, not a size. A `compact_boundary` or compact SessionStart clears the
old observation and ends a 340k or 390k closure. Smaller model windows retain
their native earlier limit. The guard does not expand a model's capacity. On the native path (dsh and
OpenCode), `PreCompact` makes the same stale-receipt exception as the Claude hook: a complete handover
that verified before an edit may compact and keeps `closure_owed = due`; a missing receipt or an
incomplete handover is still refused. Pi reaches that hook only for its own window compaction
(`native`), which a refusal would cancel, so it compacts regardless and owes the handover and
checkpoint in the new epoch, as Codex and Droid do.

**Guarantee:** this is checkpoint-based enforcement, not a proof of an absolute 390k ceiling.
Claude Code exposes no qualified before-every-request admission callback here. A large tool
result or response may cross a threshold before another hook runs. `tools/context/run --strict`
therefore refuses execution rather than advertising unsupported strict protection. Codex, OpenCode, Pi, Grok and Droid apply the same rule through `tools/agents/hook.py`, from the context size
each harness measures; see [compatibility](agent-compatibility.md). A Pi settlement that still owes
closure is continued three times, then settles with the reason shown instead of repeating one alert.
A live Claude 340k run has been reported once, by an adopting project on 2026-11-26. It ran in the
desktop app, which loads `.claude/settings.json` (the hooks and `autoCompactWindow`) without
`tools/context/run`. It compacted, resumed in the same session and verified its checkpoint, through
the handover-after-compaction path above. The 390k path remains unverified live.

The 2026-10-26 OpenCode experiment exercised a
real paid DeepSeek V4.1 Flash call with 278,859 input tokens and a native refusal after a tool result
crossed the experimental reserved budget. It establishes a primary HTTP admission mechanism in
an isolated profile; it does not enable Æion Template strict mode or qualify handover/compaction and
auxiliary-call coverage.

Use `tools/context/run [claude arguments]` for managed interactive/headless runs. It passes
`--autocompact 340000` and refuses explicit compaction overrides. Hooks are an accidental-behavior guard, not isolation against malicious code that can
edit its own scripts/settings. Raw CLI launches outside the managed entry point are not qualified.

## One rule, five harnesses

| Harness | Context size it measures | Compaction at 340k |
| --- | --- | --- |
| Claude Code | the session transcript's last request | native, `autoCompactWindow: 340000` |
| Codex | the rollout's newest `token_count` after the newest `compacted` record | native at 340000 (`model_auto_compact_token_limit`); a compaction before the handover owes it after |
| OpenCode | the newest `session.step.ended` tokens (input, output, cache) | the plugin calls `session.compact` |
| Pi | `ctx.getContextUsage().tokens` | the extension compacts at settlement in TUI/RPC; the RPC headless runner keeps the process alive for that compaction; a one-shot print/JSON run stops cleanly at the gate with the verified handover (1.9.2) |
| dsh | `ctx.tokenMeter.measure(session).totalTokens` | the plugin compacts before the next step through the root service (headless), or runs `/compact` on idle where the web profile isolates that service inside an agent-preset group |
| Droid | `lastCallTokenUsage` in `<session_id>.settings.json` beside the transcript | native auto-compaction at 355000 (`compactionTokenLimit` in `.factory/settings.json`) right after the 340k verified handover, resuming automatically via compact `SessionStart`; edits after that handover keep code open, and the resume names the files they changed; a compaction before the handover owes it after, as for Codex |

Droid's own context meter is not that figure. On 2026-11-24 it showed "1.2M of 355K tokens, 338%"
while `lastCallTokenUsage` stood between 340k and 355k: the 340k alert had fired five minutes
before, and the native compaction came two minutes later, at 355k on the same count. Between the
two compactions 27 screenshots (4.1 million base64 characters) sat in the context; text alone came to
about 353k tokens, and counting the base64 as text gives about 1.38M, so the meter appears to count
images as text. The hook and the compaction agree, so trust `lastCallTokenUsage`; the image budget in
[bounded intake](../policies/bounded-intake.md) keeps screenshots from piling up.

A harness reports usage after the response that asked for a tool, so the adapter keeps the last count
until a new one arrives (0 after a compaction). A malformed count or a rollout from another session
fails closed. Codex without a `transcript_path` keeps only its native compaction and refusal. Pi and
OpenCode compact themselves on the hook's `aeion.compact` signal, sent once a closure's checkpoint
is verified, so the context never waits for the model window. OpenCode did so live on 2026-11-02. Pi
compacts at settlement when the run is interactive or driven through `tools/agents/run pi rpc`; a
one-shot print run stops cleanly at the gate instead (1.9.2). Pi never cancels its own compaction at
the model window: it runs and the closure is owed after it. OpenCode sends no compact SessionStart, so
its allowed compaction itself ends the closure (state RECOVERING, usage cleared). dsh web runs
`/compact` once the agent is idle, so its gate holds like the others; a hard gate owes one verified
handover and stops denying once the receipt matches, so a compaction that never lands cannot hold
the session. A profile with no compaction service gets the advisory gate. Codex ends its turn on a
refused compaction and retries it before every turn, so it would stall: when Codex compacts before its
handover is verified (owner decision 2026-10-28), the compaction runs and the session resumes in closure,
allowed only the handover, `work/current.md`, docs and the checkpoint until the checkpoint passes. A live
2026-11-02 OpenCode 2.2.0 run compacted at 272k on a two-tool turn; a one-tool turn can miss the
step-usage event, which arrives after the tool hook. Pi's headless 340k run no longer crashes:
1.9.2 stops `pi -p` cleanly at the gate with the verified handover, and
`tools/agents/run pi rpc` compacts at settlement and resumes in one process (live 2026-11-02 at
288,668 tokens; the TUI path was not re-tested; see [agent compatibility](agent-compatibility.md)).
When dsh compaction does not run, its messages give the recovery step: once the handover,
`work/current.md` and the checkpoint verify, stop and start a new session from the handover.
After a compaction the [doc gate](../components/doc-gate.md) forgets the docs read before it, so the
resumed agent reads a covered file's docs again before editing it; the handover and docs stay editable.

Verification: `python3 tools/context/tests/test_budget.py`, `tools/agents/tests/test_hooks.py`,
`test_pi.mjs` and `test_opencode.mjs`. Synthetic fixtures prove state and
refusal behavior; they do not establish live runtime guarantees. The existing Stop hook remains
a once-only normal sign-off reminder, separate from the mandatory pre-compaction checkpoint.

All three managed entry points are available through `tools/agents/run <agent>`. The original
Claude entry point remains supported and now always enters the repository root before launch.

Checkpoint task-state checks include nonignored untracked files, not only tracked diffs. A resumed
pending warning asks for closure; only a verified actual compaction can report a retained checkpoint.

#!/usr/bin/env python3
# Spec: knowledge/operations/context-safety.md
"""Native-usage checkpoints and atomic handover receipts; not pre-request admission control."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".claude/hooks"))
from secret_names import is_secret  # noqa: E402
from project_files import git_active, project_files  # noqa: E402
import handovers  # noqa: E402
NOTICE = 300_000
WARNING = 340_000
LIMIT = 390_000
# Every message names the thresholds from these labels, so the text never drifts from the numbers.
NOTICE_K = f"{NOTICE // 1000}k"
WARN_K = f"{WARNING // 1000}k"
LIMIT_K = f"{LIMIT // 1000}k"
MAX_TAIL = 4 * 1024 * 1024
FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
DOC_ROOTS = ("knowledge/", "work/")
DOC_FILES = {"AGENTS.md", "CLAUDE.md", "README.md", "command.md", "Workflow_Agent.md", "CREDITS.md"}
CHECKS = (("tools/knowledge/knowledge-check",), ("tools/repo-health/repo-health",))


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def session_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
        raise ValueError("invalid session identifier")
    return value


def identity(event):
    parent = session_id(event.get("session_id"))
    agent = event.get("agent_id")
    if agent is None:
        return parent, event.get("transcript_path"), parent
    agent = session_id(session_id(agent).removeprefix("agent-"))
    key = "agent-" + hashlib.sha256(f"{parent}/{agent}".encode()).hexdigest()[:40]
    transcript = Path(event.get("agent_transcript_path") or event["transcript_path"])
    stem = "agent-" + agent.removeprefix("agent-")
    subagents = Path(event.get("transcript_path") or transcript).parent / parent / "subagents"
    if transcript.stem == parent:
        transcript = subagents / f"{stem}.jsonl"
    # A workflow's agents write under subagents/workflows/<run>/; without that path every call is denied.
    if not transcript.exists():
        transcript = next(iter(sorted(subagents.glob(f"workflows/*/{stem}.jsonl"))), transcript)
    if transcript.stem not in {agent, stem}:
        raise ValueError("subagent usage must not reuse its parent's transcript")
    return key, str(transcript), transcript.stem


@contextmanager
def locked(root, session):
    folder = root / ".aeion/context"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / f"{session}.lock").open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield folder / f"{session}.json"


def native_usage(path, session):
    transcript = Path(path)
    if transcript.is_symlink() or transcript.name != f"{session}.jsonl":
        raise ValueError("usage must come from this session's regular JSONL transcript")
    if not transcript.exists():
        return None
    with transcript.open("rb") as stream:
        size = stream.seek(0, 2)
        start = max(0, size - MAX_TAIL)
        stream.seek(start)
        if start:
            stream.readline()
        tail = stream.read(MAX_TAIL)
        lines = tail.splitlines()
    for index in range(len(lines) - 1, -1, -1):
        try:
            record = json.loads(lines[index])
        except json.JSONDecodeError:
            if index == len(lines) - 1 and not tail.endswith(b"\n"):
                return None
            raise
        if not isinstance(record, dict):
            raise ValueError("invalid transcript record")
        if record.get("subtype") == "compact_boundary":
            return None
        if record.get("type") != "assistant":
            continue
        message = record.get("message", {})
        if not isinstance(message, dict):
            raise ValueError("invalid transcript record")
        # API errors and hook stops are written as synthetic assistant records with zero tokens: they
        # were never sent, so reading them as the latest request would block every later prompt.
        if message.get("model") == "<synthetic>":
            continue
        usage = message.get("usage")
        if usage is None:
            continue
        if not isinstance(usage, dict) or any(type(usage.get(key)) is not int or usage[key] < 0 for key in FIELDS):
            raise ValueError("invalid native token counts")
        return sum(usage[key] for key in FIELDS) or None
    return None


def observed_usage(path, session):
    # Native transcripts are asynchronous; wait briefly without granting unmeasured work.
    for attempt in range(3):
        usage = native_usage(path, session)
        if usage is not None:
            return usage
        if attempt < 2:
            time.sleep(0.05)
    return None


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, check=True).stdout


def base_ref(root):
    """A ref this work merges into that actually exists: origin/develop, then origin/main, then HEAD."""
    for ref in ("origin/develop", "origin/main", "HEAD"):
        if subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=root,
                          capture_output=True, check=False).returncode == 0:
            return ref
    return None


def checkpoint_command(root, session):
    """The closure command for this folder: an existing base ref under git, and no base in a plain folder."""
    command = f"python3 tools/context/budget.py checkpoint --session {session}"
    try:
        if not git_active(root):
            return command + " --verify"
    except subprocess.SubprocessError:
        pass
    base = base_ref(root)
    # A repository without a commit has no base; the refusal names --base rather than inventing one.
    return command + (f" --base {base}" if base else "") + " --verify"


def tree_files(root):
    """{path: digest} for untracked task files and tracked bytes, without following symlinks. A deleted path is
    absent, as it is once the deletion is committed, so the receipt and its stale-path list agree."""
    files = {}
    for rel in project_files(root, untracked=True):
        if rel.startswith(("work/handovers/", ".aeion/")) or is_secret(Path(rel).name):
            continue
        path = root / rel
        if path.is_symlink():
            files[rel] = "link:" + os.readlink(path)
        elif path.is_file():
            files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return files


def fingerprint(root, files=None):
    # The bytes alone, never the commit HEAD names: the checks verified these bytes, and committing them (the team
    # flow commits the handover's docs) staled the receipt and sent the session back into closure, in a loop.
    digest = hashlib.sha256(b"tree")
    for rel, value in (tree_files(root) if files is None else files).items():
        digest.update(os.fsencode(rel) + b"\0" + value.encode())
    return digest.hexdigest()


def failure_lines(output, limit=50):
    """What a failing check said, for its refusal: every `RULE`/`FAIL` line whole and on its own line, so one pass
    fixes them all (a tail cut the first violations off and split one mid-path); the output's tail when it names
    none. Past `limit` the refusal counts the rest, so a large backlog never floods a context near its limit."""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    named = [line for line in lines if line.startswith(("RULE ", "FAIL "))]
    if not named:
        return [" ".join(" ".join(lines).split())[-800:]] if lines else []
    hidden = [f"... and {len(named) - limit} more; fix these, then verify again."] if len(named) > limit else []
    return named[:limit] + hidden + [line for line in lines if line.startswith("RESULT:")][-1:]


def changed_paths(before, after, limit=5):
    """The paths whose bytes differ between two tree_files maps, named so a live log is easy to spot."""
    paths = sorted(rel for rel in before.keys() | after.keys() if before.get(rel) != after.get(rel))
    return ", ".join(paths[:limit]) + (f" and {len(paths) - limit} more" if len(paths) > limit else "")


HEADINGS = handovers.HEADINGS
# Half the bounded-intake limit, so the next context reads the whole handover in one call.
HANDOVER_BYTES = 32 * 1024
HANDOVER_LINE = 1000
SHAPE ="the handover uses the exact lines " + ", ".join(f"## {h}" for h in HEADINGS)


def handover_path(root, session):
    return handovers.folder(root) / f"{session}.md"


def ensure_handover(root, session):
    path = handover_path(root, session)
    if not path.exists():
        atomic(path, handovers.skeleton(session))
    return path


def handover_faults(path):
    """Named faults that keep a handover from being a checkpoint: a missing exact heading, a section still TODO,
    and a size the next context cannot read whole (bounded intake refuses a full read above 64 KiB)."""
    data = path.read_bytes()
    text = data.decode(errors="replace")
    missing = [f"## {key}" for key in HEADINGS if f"## {key}\n" not in text]
    long = [str(number) for number, line in enumerate(text.splitlines(), 1) if len(line) > HANDOVER_LINE]
    return ([f"missing heading{'s' if len(missing) > 1 else ''}: {', '.join(missing)} (exact line)"] if missing else []) \
        + (["a section still reads TODO"] if "TODO" in text else []) \
        + ([f"{len(data)} bytes, over {HANDOVER_BYTES}: drop what a newer line supersedes and what commits or docs "
            f"already hold"] if len(data) > HANDOVER_BYTES else []) \
        + ([f"line{'s' if len(long) > 1 else ''} {', '.join(long[:5])} over {HANDOVER_LINE} characters: split "
            f"{'them' if len(long) > 1 else 'it'}"] if long else [])


def ready(root, session, state):
    handover = handover_path(root, session)
    receipt = state.get("checkpoint", {})
    return (handover.is_file() and receipt.get("tree") == fingerprint(root)
            and receipt.get("handover") == hashlib.sha256(handover.read_bytes()).hexdigest())


def closure_tool(root, event):
    """What closure admits at 340k and 390k alike: reads, docs and task state, the fixed checks and this root's
    checkpoint. The checkpoint verifies those docs (doc-links L3) and work/current.md, so 390k keeps them open too;
    code stays frozen at both."""
    tool = event.get("tool_name")
    data = event.get("tool_input", {})
    if not isinstance(data, dict):
        return False
    # An adapter marks a call closure admits: a harness tool that acts only through calls this gate judges one by
    # one (Droid's Script), or any Droid call once its 340k handover verified (tools/agents/hook.py).
    if event.get("closure_safe") is True:
        return True
    # The handover must describe live state (a background run, an open page), so reading it stays open.
    if tool in {"Read", "Grep", "Glob", "TaskOutput", "BashOutput"}:
        return True
    if isinstance(tool, str) and tool.startswith(BROWSERS):
        action = tool.rsplit("__", 1)[-1]
        return action in BROWSER_READS or (action == "computer" and data.get("action") in SCREEN_READS)
    if tool in {"Edit", "Write"}:
        return doc_path(root, Path(data.get("file_path", "")))
    if tool == "Bash":
        command = data.get("command", "")
        if not isinstance(command, str):
            return False
        fixed = {"tools/knowledge/knowledge-check", "tools/knowledge/doc-links", "tools/repo-health/repo-health",
                 "git status --short", "git diff --stat", "git diff --check"}
        if command.strip() in fixed:
            return True
        try:
            words = shlex.split(command)
        except ValueError:
            return False
        return (read_call(command, words) or git_read(command, words) or git_doc_write(root, event, command, words)
                or checkpoint_call(root, event, words))
    return False


def doc_path(root, path):
    """A path closure may change: "affected docs" include a project's own Markdown wherever it lives, and work/.
    A path that no longer exists still counts by its name, so a doc's deletion can be staged and committed."""
    path = path.resolve()
    if not path.is_relative_to(root) or path.is_dir():
        return False
    rel = path.relative_to(root).as_posix()
    return rel in DOC_FILES or rel.startswith(DOC_ROOTS) or path.suffix.lower() in {".md", ".mdx"}


def git_doc_write(root, event, command, words):
    """`git add <doc files>` and `git commit -m <message>` while only doc paths are staged: the team flow commits
    the handover's docs and work/current.md. No flag beyond -m/-q, so no --amend, -a, hook skipping or pathspec."""
    if len(words) < 3 or words[0] != "git" or words[1] not in {"add", "commit"} or SHELL_OPERATORS.search(command):
        return False
    here = Path(event.get("cwd") or root)
    if words[1] == "add":
        paths = [word for word in words[2:] if word != "--"]
        # A leading colon is pathspec magic (`:!README.md` stages everything else), never a file name here.
        return bool(paths) and all(not word.startswith(("-", ":")) and doc_path(root, here / word) for word in paths)
    rest = words[2:]
    while rest[:1] == ["-q"]:
        rest = rest[1:]
    if len(rest) < 2 or len(rest) % 2 or any(flag not in {"-m", "--message"} for flag in rest[::2]):
        return False
    # The index decides what a commit records, so every staged path must be one closure could have edited. A
    # rename lists only its destination, which would hide a code file's deletion behind a Markdown name.
    staged = subprocess.run(["git", "diff", "--cached", "--no-renames", "--name-only", "-z"], cwd=root,
                            capture_output=True, check=False)
    paths = [os.fsdecode(path) for path in staged.stdout.split(b"\0") if path]
    return staged.returncode == 0 and bool(paths) and all(doc_path(root, root / path) for path in paths)


# Shell-only harnesses (Codex) read through these, so closure must let them read the handover and docs.
READERS = {"cat", "head", "tail", "wc", "nl", "ls", "grep", "rg"}
# Browser tools that only look at the page already open: navigation, clicks and typing stay frozen.
BROWSERS = ("mcp__Claude_Browser__", "mcp__claude-in-chrome__", "mcp__remote-devices__Claude_Browser__")
BROWSER_READS = {"find", "read_page", "get_page_text", "tabs_context", "tabs_context_mcp", "read_console_messages",
                 "read_network_requests"}
SCREEN_READS = {"screenshot", "zoom"}
GIT_READS = {"status", "log", "show", "diff"}
CLOSURE_ADMITS = ("Closure admits: Read, Grep, Glob, task and browser-page reads; edits to Markdown, work/ and the "
                  "handover; one plain cat/head/tail/wc/ls/grep/rg or sed -n; git status/log/show/diff; git add of "
                  "doc files and git commit -m while only docs are staged; the fixed checks; the checkpoint command. "
                  "Web fetches, code and subagents wait for the receipt.")
SHELL_OPERATORS = re.compile(r"[;&|<>`$\n*?\[{~]")


def git_read(command, words):
    """One plain `git status|log|show|diff`, so the handover can name commits and changes. `--output` writes a
    file, `--ext-diff` runs a program and `--no-index` reads outside the repository: those stay closed."""
    if len(words) < 2 or words[0] != "git" or words[1] not in GIT_READS or SHELL_OPERATORS.search(command):
        return False
    return not any(word.startswith(("--output", "--ext-diff", "--no-index")) or is_secret(Path(word.split(":")[-1]).name)
                   for word in words)


def read_call(command, words):
    """One plain read command: no shell operators or globs, no secret file, no `rg --pre` program, and `sed`
    only as `sed -n <lines>p <files>`."""
    if not words or SHELL_OPERATORS.search(command) or any(is_secret(Path(word).name) for word in words):
        return False
    if words[0] == "sed":
        return len(words) >= 3 and words[1] == "-n" and re.fullmatch(r"\d+(,\d+)?p", words[2]) is not None
    return words[0] in READERS and not any(word.startswith("--pre") for word in words)


def checkpoint_call(root, event, words):
    """This root's checkpoint from any working directory, since a shell left in a subfolder must still
    close: `[cd <root> &&] python3 <its budget.py> checkpoint --session <this session> [--base <ref>]
    --verify`, or a bare `cd <root>`. Paths are resolved, never trusted by spelling."""
    here = Path(event.get("cwd") or root)
    if words[:1] == ["cd"]:
        if len(words) < 2 or (here / words[1]).resolve() != root:
            return False
        if len(words) == 2:
            return True
        if words[2] != "&&":
            return False
        here, words = root, words[3:]
    if len(words) < 2 or words[0] != "python3" or (here / words[1]).resolve() != root / "tools/context/budget.py":
        return False
    rest = words[2:]
    if rest[:2] != ["checkpoint", "--session"] or rest[-1:] != ["--verify"]:
        return False
    # The session token is not compared against this session: the CLI refuses a key that names no session, and the
    # gate opens on this session's verified receipt (`ready`), never on the spelling. Comparing it refused the exit
    # command of an agent that wrote the raw identifier instead of the hashed key, with no way back.
    if re.fullmatch(r"[A-Za-z0-9_-]{1,200}", rest[2]) is None:
        return False
    # A plain folder has no base; a repository names one ref.
    return len(rest) == 4 or (len(rest) == 6 and rest[3] == "--base"
                              and re.fullmatch(r"[A-Za-z0-9_./-]+", rest[4]) is not None)


def apply_usage(root, session, state, name, event, usage):
    """The 340k/390k rule every harness shares, from the context usage that harness measured."""
    handover = handover_path(root, session)
    state["observed_tokens"] = usage
    result = {}
    if usage is None and name == "UserPromptSubmit" and not state.get("bootstrapped"):
        state["bootstrapped"] = True
    elif usage is None:
        reason = "Æion Template native usage temporarily unavailable; work is blocked. Retry after transcript persistence; no terminal stop was latched."
        # Transcripts persist asynchronously: deny only this call so the agent can retry it, not stop the agent.
        if name == "PreToolUse":
            result = {"hookSpecificOutput": {"hookEventName": name, "permissionDecision": "deny", "permissionDecisionReason": reason}}
        elif name != "PostToolUse":
            result = stop(name, reason)
    else:
        state["bootstrapped"] = True
        # A verified receipt settles the debt the 390k stopgap deferred; the state machine then continues as before.
        if state.get("closure_owed") == "due" and ready(root, session, state):
            state.pop("closure_owed", None)
        # 390k never stops the run: it forces the handover and compaction again, with the same closure as 340k.
        if usage >= LIMIT and state["state"] != "COMPACT_REQUIRED":
            state["state"] = "COMPACT_REQUIRED"
            state["warning_pending"] = True
        elif usage >= WARNING and state["state"] not in {"HANDOVER_REQUIRED", "COMPACT_REQUIRED"}:
            state["state"] = "HANDOVER_REQUIRED"
            state["warning_pending"] = True
        elif (0 < usage < WARNING and state["state"] in {"HANDOVER_REQUIRED", "COMPACT_REQUIRED"}
                and not state.get("resumed_in_closure")):
            # The context fell back under the threshold, so a compaction ran without the adapter seeing its
            # SessionStart: dsh compacts on its own. Keeping the latch would gate a 127k session forever, so it
            # ends here and the closure it owed becomes a debt Stop enforces instead. The debt must never keep a
            # later fall latched: a session that climbs and compacts again is still under the threshold, and
            # denying it would turn the escape hatch into a permanent gate. A latch a harness set because its own
            # compaction resumed in closure is not a threshold latch: `resumed_in_closure` keeps it until the
            # handover verifies, which is the whole point of that resume.
            # A zero is the stand-in for a harness that has measured nothing yet, never a real measurement.
            state["state"] = "RUNNING"
            state.pop("warning_pending", None)
            if not ready(root, session, state):
                state["closure_owed"] = "due"
        if name == "PreCompact":
            if not ready(root, session, state):
                handover = ensure_handover(root, session)
                if state["state"] == "COMPACT_REQUIRED":
                    # 390k stopgap: code is already frozen here, so a check that failed before this session would
                    # leave no way to verify and no way to repair. The compaction runs, the closure stays owed.
                    state["closure_owed"] = "due"
                    result = {"systemMessage": f"Æion Template {LIMIT_K}: compacting before a verified checkpoint; the "
                                               f"closure stays owed until the failing check is fixed and "
                                               f"{handover.relative_to(root)} is verified: {checkpoint_command(root, session)}."}
                elif state.get("checkpoint") and not handover_faults(handover):
                    # The handover was verified, then an edit moved the tree: refusing here is what left a latched
                    # session unable to compact at all, because the receipt can only be refreshed by the same work
                    # the closure gate is blocking. Compact, keep the debt, and let Stop refuse until a fresh
                    # receipt settles it; an unverified handover still refuses below, so the rule keeps its teeth.
                    state["closure_owed"] = "due"
                    result = {"systemMessage": f"Æion Template {WARN_K}: {handover.relative_to(root)} was verified and the "
                                               f"tree moved since; compacting now, and the closure stays owed until a "
                                               f"fresh checkpoint: {checkpoint_command(root, session)}."}
                else:
                    moved = changed_paths(state.get("checkpoint", {}).get("files", {}), tree_files(root)) if state.get("checkpoint") else ""
                    stale = f" The receipt is stale: {moved} changed since it (git-ignore a live log)." if moved else ""
                    result = stop(name, f"Fill {handover.relative_to(root)}, then create a verified checkpoint before compaction: {checkpoint_command(root, session)}.{stale}")
        elif state["state"] in {"HANDOVER_REQUIRED", "COMPACT_REQUIRED"}:
            ensure_handover(root, session)
            first = state.pop("warning_pending", False)
            call = {**event, "session_id": session}
            if event.get("compaction_unavailable") is True:
                # The harness reaches no compaction service from this plugin (dsh web keeps it inside each agent
                # preset), so a hard gate would stall the run until a human typed /compact. Keep the alert and the
                # handover so recovery survives the harness's own compaction, and never stop the work.
                message = (f"Æion Template: this harness compacts on its own, so the {WARN_K}/{LIMIT_K} gate is advisory here. "
                           f"Keep {handover.relative_to(root)} current so the session can recover, and continue; "
                           f"verify before it compacts: {checkpoint_command(root, session)}.")
                if first or name in {"Stop", "SubagentStop"}:
                    result = {"systemMessage": message, "hookSpecificOutput": {"hookEventName": name, "additionalContext": message}}
            else:
                # The gate exists to obtain one verified handover. Once the receipt matches, denying further calls
                # only holds the session hostage until a compaction the plugin cannot guarantee actually lands.
                if state["state"] == "COMPACT_REQUIRED":
                    message = (f"Æion Template {LIMIT_K}: closure only, now: write {handover.relative_to(root)}, update "
                               f"work/current.md and the docs the checks name, and verify the checkpoint "
                               f"({checkpoint_command(root, session)}); compaction follows; {SHAPE}.")
                else:
                    message = (f"Æion Template {WARN_K} alert: finish closure only, update {handover.relative_to(root)}, work/current.md and affected docs; "
                               f"verify the checkpoint before compaction ({checkpoint_command(root, session)}); {SHAPE}.")
                allowed = ready(root, session, state) or closure_tool(root, call)
                if name == "PreToolUse" and not allowed:
                    # Name what still works and why the last receipt no longer counts, so the next call is not a guess.
                    moved = changed_paths(state["checkpoint"].get("files", {}), tree_files(root)) if state.get("checkpoint") else ""
                    stale = f" The last receipt is stale: {moved} changed since it; verify again." if moved else ""
                    reason = f"{message} {CLOSURE_ADMITS}{stale}"
                    result = {"hookSpecificOutput": {"hookEventName": name, "permissionDecision": "deny", "permissionDecisionReason": reason}}
                elif name in {"Stop", "SubagentStop"}:
                    # An agent can claim closure without running the command; name the missing receipt, so it cannot.
                    missing = "" if ready(root, session, state) else " No verified checkpoint receipt exists for this session yet."
                    result = stop(name, message + missing + " Task has not been signed off.")
                elif first and name in {"PreToolUse", "PostToolUse", "UserPromptSubmit"}:
                    result = {"systemMessage": message, "hookSpecificOutput": {"hookEventName": name, "additionalContext": message}}
                if first:
                    result["systemMessage"] = message
        elif state["state"] == "RECOVERING":
            state["state"] = "RUNNING"
        # Claude compacts natively at 340k, so the alert and the compaction arrive together and the handover gets
        # written from the summary. A notice 40k earlier asks for it while the agent still holds the detail; it
        # refuses nothing. It is sent once per climb: a fall under 300k (a compaction) re-arms it.
        if usage < NOTICE:
            state.pop("notice_sent", None)
        elif (usage < WARNING and state["state"] == "RUNNING" and not state.get("notice_sent") and not result
              and name in {"PreToolUse", "PostToolUse", "UserPromptSubmit"}):
            state["notice_sent"] = True
            handover = ensure_handover(root, session)
            message = (f"Æion Template {NOTICE_K} notice: closure starts at {WARN_K}. Fill {handover.relative_to(root)} now, "
                       f"while you hold the detail ({SHAPE}): what a compaction summary drops, the owner's rules, the "
                       f"exact next commands and the evidence ids. Nothing is refused yet.")
            result = {"systemMessage": message, "hookSpecificOutput": {"hookEventName": name, "additionalContext": message}}
        # A closure the 390k stopgap deferred is still owed: the run ends with its receipt, or not at all.
        if not result and name in {"Stop", "SubagentStop"} and state.get("closure_owed") == "due" and not ready(root, session, state):
            result = stop(name, f"Æion Template {LIMIT_K}: closure is still owed; fix the failing check and verify the "
                                f"checkpoint: {checkpoint_command(root, session)}. Task has not been signed off.")
    return result


def stop(event_name, reason):
    if event_name == "PreCompact":
        return {"decision": "block", "reason": reason}
    return {"continue": False, "stopReason": reason, "systemMessage": reason}


def claude_native_session(event):
    """Whether Claude's budget hook owns this event.

    Grok loads the same `.claude/settings.json`. It sends Claude's field names plus its own
    camelCase envelope (`hookEventName` is `user_prompt_submit`) and an `updates.jsonl` or
    `chat_history.jsonl` transcript. Judging that file as a broken Claude transcript latches STOPPED on the first
    prompt. The Grok adapter owns that session.
    """
    native = event.get("hookEventName")
    if isinstance(native, str) and re.fullmatch(r"[a-z][0-9a-z_]*", native):
        return False
    path = event.get("transcript_path")
    # updates.jsonl is the path Grok puts in transcript_path. chat_history.jsonl is the older name.
    if isinstance(path, str) and Path(path).name in {"chat_history.jsonl", "updates.jsonl"}:
        return False
    return True


def handle(root, event):
    root = root.resolve()
    if not isinstance(event, dict):
        raise ValueError("hook input must be an object")
    # Leave Grok's envelope untouched, including a session an older hook already marked STOPPED.
    if not claude_native_session(event):
        return {}
    session, transcript, transcript_id = identity(event)
    name = event.get("hook_event_name")
    if name not in {"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact", "Stop", "SubagentStop"}:
        raise ValueError("unsupported control event")
    with locked(root, session) as file:
        state = json.loads(file.read_text()) if file.exists() else {"epoch": 0, "state": "RUNNING"}
        state["owner_session"] = event["session_id"]
        state["agent_id"] = event.get("agent_id")
        # The skeleton is created only when closure needs it, so ordinary sessions and subagents leave none.
        handover = handover_path(root, session)
        compact_verified = name == "SessionStart" and event.get("source") == "compact" and ready(root, session, state)
        if name == "SessionStart" and event.get("source") == "compact" and state.get("state") != "STOPPED":
            # A compaction the 390k stopgap let through still owes its closure; the new epoch must not forget it.
            owed = state.get("closure_owed") == "due"
            state = {"epoch": state["epoch"] + 1, "state": "RECOVERING", "warning_pending": state.get("warning_pending", False)}
            if owed:
                state["closure_owed"] = "due"
        result = {}
        if state.get("state") == "STOPPED":
            result = stop(name, "Æion Template context run is stopped; start a new validated session from its handover.")
        elif name == "SessionStart":
            context = f"Æion Template checkpoint profile: {WARN_K} handover/compact, {LIMIT_K} forced handover and compaction; not a strict ceiling."
            if handover.is_file():
                context += f" Recovery: {handover.relative_to(root)}"
            if state.get("closure_owed") == "due":
                context += (f" Closure still owed from a compaction before the handover: fix the failing check, then verify the "
                            f"checkpoint: {checkpoint_command(root, session)}.")
            result = {"hookSpecificOutput": {"hookEventName": name, "additionalContext": context}}
            if state.pop("warning_pending", False):
                message = (f"Æion Template {WARN_K} alert: a verified handover was retained before compaction." if compact_verified
                           else f"Æion Template {WARN_K} alert: closure remains required; verify the handover/docs before compaction.")
                result["systemMessage"] = message
                result["hookSpecificOutput"]["additionalContext"] += "\n" + message
        else:
            try:
                usage = observed_usage(transcript, transcript_id)
            except (ValueError, OSError, TypeError, AttributeError):
                state["state"] = "STOPPED"
                atomic(file, json.dumps(state, sort_keys=True) + "\n")
                return stop(name, "Æion Template native usage is invalid; refusing further work.")
            result = apply_usage(root, session, state, name, event, usage)
            state["source"] = "current-session native transcript usage"
        atomic(file, json.dumps(state, sort_keys=True) + "\n")
        return result


def checkpoint(root, session, base):
    # Without git there is no base to diff, no task state ritual and no commit to compare.
    repository = git_active(root)
    if repository and base is None:
        raise ValueError("--base is required in a git repository")
    if repository:
        try:
            base = git(root, "rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}").decode().strip()
        except subprocess.CalledProcessError:
            raise ValueError(f"--base {base!r} is not a commit here; use {base_ref(root) or 'an existing ref'}") from None
    with locked(root, session) as file:
        state = json.loads(file.read_text())
        if state["state"] == "STOPPED":
            raise ValueError("a stopped run cannot request another closure pass")
        handover = ensure_handover(root, session)
        # Name each fault: a heading spelled `## Completed (commits)` reads as complete to a person.
        faults = handover_faults(handover)
        if faults:
            raise ValueError(f"complete all handover sections first: {'; '.join(faults)}")
        files = tree_files(root)
        before = fingerprint(root, files)
        diff = (("tools/knowledge/doc-links", "--diff", base, "--worktree"),) if repository else ()
        # The check's own output is the only actionable part of a refusal; a bare exit status loops the agent.
        for command in (*CHECKS, *diff):
            result = subprocess.run(command, cwd=root, timeout=30, capture_output=True, text=True)
            if result.returncode:
                detail = failure_lines(result.stdout + result.stderr)
                raise ValueError(f"{command[0]} failed (exit {result.returncode})"
                                 + (":\n" + "\n".join(detail) if detail else ""))
        changed = set() if not repository else set(git(root, "diff", "--name-only", "-z", base).decode().split("\0")) - {""}
        changed |= {os.fsdecode(path) for path in (git(root, "ls-files", "--others", "--exclude-standard", "-z") if repository else b"").split(b"\0")
                    if path and not os.fsdecode(path).startswith((".aeion/", "work/handovers/"))}
        # Local mode, the default, keeps no work/current.md entry; only the team flow (aeion.mode team) does.
        local = not repository or subprocess.run(["git", "config", "--local", "--get", "aeion.mode"], cwd=root, capture_output=True, text=True).stdout.strip() != "team"
        if changed and not local and "work/current.md" not in changed:
            raise ValueError("update work/current.md before checkpointing")
        after = tree_files(root)
        if fingerprint(root, after) != before:
            raise ValueError(f"files changed during checkpoint validation: {changed_paths(files, after)} "
                             "(a live log in the tree makes every receipt stale: git-ignore it)")
        # The closure the receipt was taken in: Droid keeps a 340k one open until its compaction.
        state["checkpoint"] = {"tree": before, "files": files, "handover": hashlib.sha256(handover.read_bytes()).hexdigest(),
                               "state": state["state"]}
        # `closure_owed` stays until the next event reads this receipt: Codex and Droid leave their closure state
        # only on that event, so dropping the flag here would strand them in a closure that is already satisfied.
        atomic(file, json.dumps(state, sort_keys=True) + "\n")
        handovers.record(root, session)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["checkpoint"])
    parser.add_argument("--session", required=True, type=session_id)
    parser.add_argument("--base", help="the branch this work merges into; required under git")
    parser.add_argument("--verify", action="store_true", required=True)
    args = parser.parse_args()
    try:
        checkpoint(ROOT, args.session, args.base)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Checkpoint refused: {error}\n")
    print("Checkpoint: PASS")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# Spec: knowledge/operations/build-and-test.md
"""SessionStart hook: at most 25 lines of facts — the flow mode, uncommitted changes, recent commits,
open tasks and the health scorecard — so a new or resumed session starts from evidence."""
import json
import os
import re
import select
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".claude/hooks"))
from project_files import git_active  # noqa: E402
import aeion_settings  # noqa: E402
import handovers  # noqa: E402

STALE_DAYS = 30
WAITING = ("— WAITING-OWNER", "— BACKLOG")


def out(*command):
    return [l for l in subprocess.run(command, cwd=ROOT, capture_output=True, text=True).stdout.split("\n") if l.strip()]


def heading_ages(heading_lines):
    """{line number: commit time} for work/current.md's heading lines, from one `git blame --porcelain`."""
    blame = subprocess.run(["git", "blame", "--porcelain", "--", "work/current.md"], cwd=ROOT, capture_output=True,
                           text=True, check=False).stdout.split("\n")
    times, at, commit = {}, {}, None
    wanted = {number for number, _ in heading_lines}
    for line in blame:
        header = re.fullmatch(r"([0-9a-f]{40}) \d+ (\d+)(?: \d+)?", line)
        if header:
            commit = header.group(1)
            if int(header.group(2)) in wanted:
                at[int(header.group(2))] = commit
        elif line.startswith("committer-time ") and commit:
            times[commit] = int(line.split()[1])
    # An uncommitted line blames the all-zero commit, whose time is now.
    return {number: times.get(commit, time.time()) for number, commit in at.items()}


# The hook event names the session. Run by hand, or under a parent whose stdin stays open, waiting for EOF would
# hang the start: read chunks as they arrive, until EOF or 0.2 s of silence.
try:
    data = b""
    while not sys.stdin.isatty() and len(data) < 1024 * 1024 and select.select([sys.stdin], [], [], 0.2)[0]:
        chunk = os.read(sys.stdin.fileno(), 65536)
        if not chunk:
            break
        data += chunk
    event = json.loads(data or b"{}")
except (ValueError, OSError):
    event = {}


def capped(items):
    """At most six lines: every item, or the first five and how many were left out."""
    shown = items if len(items) <= 6 else items[:5] + [f"… and {len(items) - 5} more"]
    return ["  " + item[:110] for item in shown]


lines = []
lines += ["Bounded intake: full reads/dumps above 64 KiB or 400 lines are refused.",
          "Use targeted Read ranges, limited searches and summaries; see knowledge/policies/bounded-intake.md."]
try:
    repository = git_active(ROOT)
except subprocess.SubprocessError:
    repository = None
if repository is None:
    lines.append("git: this folder has a .git that git cannot read; repair it before any commit.")
elif not repository:
    # A plain folder: no branch, pull request, review, CI or tag; done means the tests pass.
    lines.append("git: inactive (plain folder); the branch, review, CI and release flow is skipped.")
else:
    # The flow mode decides whether work ends in a reviewed push or a local commit; local unless set to team.
    if out("git", "config", "--local", "--get", "aeion.mode") != ["team"]:
        lines.append("Æion Template mode: local (git lifecycle off: no develop, review, PR or release gate; "
                     "safety guards stay on). Team flow: README.md#team-git-flow")
    else:
        branch = " ".join(out("git", "branch", "--show-current")) or "a detached HEAD"
        lines.append(f"Æion Template mode: team on {branch} "
                     "(develop: review before each push; main: release PR). Local: git config --unset aeion.mode")
        # Team work happens on develop; main moves only through the release pull request.
        if branch == "main":
            lines.append("branch: main; team work happens on develop (git switch develop)")
        # The pre-commit checks and the pre-push review gate run only when git uses the repository's hooks.
        hooks = out("git", "config", "--path", "--get", "core.hooksPath")
        if not hooks or (ROOT / hooks[0]).resolve() != (ROOT / "tools/git-hooks").resolve():
            lines.append("git hooks: off; enable with git config core.hooksPath tools/git-hooks")
    # Uncommitted changes: one you cannot explain is not yours.
    status = out("git", "status", "--short")
    lines.append(f"git status: {len(status)} changed path(s)" if status else "git status: clean")
    lines += capped(status)
    # The last commits.
    lines.append("last commits:")
    lines += ["  " + s for s in out("git", "log", "-5", "--oneline")]
# The owner's settings: what the doc gate does before an edit, and whether the spec comes from aeion-framework.
gate, gate_problem = aeion_settings.doc_gate(ROOT)
url, _, framework_problem = aeion_settings.framework(ROOT)
if framework_problem:
    framework = f"off ({framework_problem})"
elif url:
    version, unready = aeion_settings.cached_health(ROOT, url)
    framework = (f"on → {url} (aeion-framework {version}, ready)" if version
                 else f"on → {url}, but {unready}; spec reads fail until it answers") + "; skill framework"
else:
    framework = "off"
    # Committed @req annotations say this project is specified with aeion-framework; this clone is not connected.
    if aeion_settings.annotated(ROOT):
        framework += "; this code carries @req IDs: the owner connects it with tools/aeion-settings framework"
lines.append(f"doc gate: {gate}" + (f" ({gate_problem})" if gate_problem else "") + f"; framework: {framework}")
# Handovers: skeletons nobody filled are pruned after a week; this session's own one says when it is behind.
# Before the task list, so the 25-line cap trims tasks, never a stale recovery pointer.
pruned = handovers.prune(ROOT)
if pruned:
    lines.append(f"handovers: removed {pruned} unfilled skeleton(s) older than {handovers.PRUNE_DAYS} days")
session = event.get("session_id") if isinstance(event, dict) else None
if isinstance(session, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session):
    moved = handovers.behind(ROOT, handovers.folder(ROOT) / f"{session}.md")
    if moved:
        lines.append(f"handover: work/handovers/{session}.md is behind ({' and '.join(moved)} moved after it was "
                     "saved); check git log and work/current.md before trusting it, and update it.")
# Open tasks: the ones moving are listed; the ones waiting on the owner are counted, with the oldest one's age,
# so they stop repeating at every start and still remind the owner. An entry's age is when its heading line
# (title and status) last changed in git; uncommitted lines are today's.
work = ROOT / "work/current.md"
heading_lines = [(n, l[3:]) for n, l in enumerate(work.read_text(encoding="utf-8").split("\n"), 1)
                 if l.startswith("## ")] if work.exists() else []
changed_at = heading_ages(heading_lines) if repository else {}
moving, waiting = [], []
for number, title in heading_lines:
    since = changed_at.get(number)
    old = since is not None and time.time() - since > STALE_DAYS * 86400
    label = title + (f" (unchanged since {time.strftime('%Y-%m-%d', time.gmtime(since))})" if old else "")
    (waiting if title.endswith(WAITING) else moving).append((since, label))
summary = f"work/current.md: {len(heading_lines)} open task(s)"
if waiting:
    oldest = min((since for since, _ in waiting if since is not None), default=None)
    summary += f"; {len(waiting)} waiting on the owner or in backlog" + (
        f", oldest unchanged since {time.strftime('%Y-%m-%d', time.gmtime(oldest))}" if oldest else "")
lines.append(summary)
lines += capped([label for _, label in moving])
# The scorecard always shows; the lists above give way to it within the 25 lines.
score = out("tools/repo-health/repo-health")[:25]
print("\n".join(lines[:25 - len(score)] + score))

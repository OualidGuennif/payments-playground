# Spec: knowledge/operations/context-safety.md
"""Handover files: the skeleton closure creates, whether anyone wrote into one, pruning, and whether one is behind."""
import hashlib
import json
import subprocess
import time

from project_files import git_active

HEADINGS = ("Scope", "Completed", "Remaining", "Constraints", "Evidence")
# Each prompt asks for what a compaction summary drops, so the handover does not restate the summary.
PROMPTS = {"Scope": "the task, what the owner asked and what is out of scope",
           "Completed": "what is done, with its commits or pull requests",
           "Remaining": "the exact next commands, in order",
           "Constraints": "the owner's rules and decisions a summary would drop",
           "Evidence": "check results, review and run ids, links"}
PRUNE_DAYS = 7


def folder(root):
    return root / "work/handovers"


def skeleton(session):
    return f"# Handover {session}\n\n" + "\n\n".join(f"## {h}\nTODO: {PROMPTS[h]}" for h in HEADINGS) + "\n"


def unfilled(path):
    """True when every line under the title is a heading, blank or a TODO: a skeleton nobody wrote into."""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[1:]
    return all(not line.strip() or line.startswith(("## ", "TODO")) for line in lines)


def unfilled_files(root):
    found = []
    for path in sorted(folder(root).glob("*.md")):
        # Another session starting at the same time may prune it first.
        try:
            if path.is_file() and not path.is_symlink() and unfilled(path):
                found.append(path)
        except OSError:
            continue
    return found


def prune(root, days=PRUNE_DAYS, now=None):
    """Delete unfilled skeletons older than `days`: they hold nothing, and closure writes a fresh one when needed."""
    cutoff = (now or time.time()) - days * 86400
    removed = 0
    for path in unfilled_files(root):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except FileNotFoundError:
            continue
    return removed


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() and not path.is_symlink() else ""


def repository(root):
    """Whether root is its own git work tree; a .git that git cannot read counts as none here, since session start
    and the sign-off report that themselves and must still finish."""
    try:
        return git_active(root)
    except subprocess.SubprocessError:
        return False


def head(root):
    # A plain folder nested in another repository has no HEAD of its own; git would answer for the parent.
    if not repository(root):
        return ""
    found = subprocess.run(["git", "rev-parse", "--verify", "--quiet", "HEAD"], cwd=root, capture_output=True,
                           text=True, check=False)
    return found.stdout.strip()


def receipt_path(root, session):
    return root / ".aeion/context" / f"{session}-handover.json"


def record(root, session):
    """What a verified checkpoint saw: HEAD, work/current.md and the handover's bytes. It outlives the compaction
    that drops the checkpoint receipt, so the resumed session can tell whether its handover is still current."""
    path = receipt_path(root, session)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"head": head(root), "work": digest(root / "work/current.md"),
                                "handover": digest(folder(root) / f"{session}.md")}) + "\n")


def behind(root, path):
    """What moved after a written handover: the commit HEAD names, then work/current.md. Against the checkpoint that
    verified these exact bytes when there is one, since closure writes the handover before work/current.md; else
    against the time the file was last saved."""
    if not path.is_file() or path.is_symlink() or unfilled(path):
        return []
    try:
        receipt = json.loads(receipt_path(root, path.stem).read_text())
    except (OSError, ValueError):
        receipt = None
    if isinstance(receipt, dict) and receipt.get("handover") == digest(path):
        return ([] if receipt.get("head") == head(root) else ["HEAD"]) \
            + ([] if receipt.get("work") == digest(root / "work/current.md") else ["work/current.md"])
    saved = path.stat().st_mtime
    moved = []
    committed = subprocess.run(["git", "log", "-1", "--format=%ct"], cwd=root, capture_output=True, text=True,
                               check=False) if repository(root) else None
    if committed and committed.returncode == 0 and committed.stdout.strip().isdigit() and int(committed.stdout.strip()) > saved:
        moved.append("HEAD")
    work = root / "work/current.md"
    if work.is_file() and work.stat().st_mtime > saved:
        moved.append("work/current.md")
    return moved

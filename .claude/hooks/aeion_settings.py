# Spec: knowledge/components/framework-mode.md
"""The owner's per-clone settings, read the same way by every hook and tool.

.aeion/settings.json (ignored local state, with or without git) holds two keys:
  doc_gate   "enforce" (the default), "warn" or "off": what the doc gate does before an edit
  framework  the aeion-framework API address; its presence is what turns framework mode on
AEION_FRAMEWORK_URL overrides the address for one process tree (CI, a container, a sandbox), and
AEION_FRAMEWORK_TOKEN, never stored, is sent to a gateway in front of the service.
A file that cannot be read fails closed: the gate enforces and framework mode is off."""
import http.client
import ipaddress
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from project_files import git_active, project_files

SETTINGS = ".aeion/settings.json"
HEALTH_CACHE = ".aeion/framework-health.json"
GATES = ("enforce", "warn", "off")
# The aeion-framework releases this template is written against: from 1.1 up to, not including, 2.0.
# The tech-watch moves both values once a newer release is read and tested.
SUPPORTED = ((1, 1), (2, 0))
TESTED = "1.1.9"
HEALTH_SECONDS = 600
# aeion-framework's code annotation: a comment holding "@req", then the IDs of the requirements the code
# implements on the same line, separated by spaces or commas; "@req:" and "@req(" open it too.
ID = re.compile(r"^[A-Z][A-Z0-9_]*-[0-9]{3,6}\Z")
REQ_MARK = re.compile(r"@req\b[:(]?")
REQ_NEXT = re.compile(r"[ \t]*,?[ \t]*([A-Z][A-Z0-9_]*-[0-9]{3,6})\b")
REQ_GIT = r"@req[:(]?[[:space:]]*[A-Z][A-Z0-9_]*-[0-9]{3,6}"
REQUEST_SECONDS = 3


def req_ids(text):
    """The requirement IDs the @req annotations of a text name, first seen first."""
    ids = []
    for mark in REQ_MARK.finditer(text):
        end = text.find("\n", mark.end())
        end, position = (len(text) if end < 0 else end), mark.end()
        while found := REQ_NEXT.match(text, position, end):
            ids.append(found.group(1))
            position = found.end()
    return list(dict.fromkeys(ids))


def load(root):
    """(settings, problem or None); a missing file is an empty, valid one."""
    path = Path(root) / SETTINGS
    if not path.exists():
        return {}, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return {}, f"{SETTINGS} is unreadable ({type(error).__name__}): the doc gate enforces and framework mode is off"
    if not isinstance(data, dict):
        return {}, f"{SETTINGS} is not a JSON object: the doc gate enforces and framework mode is off"
    return data, None


def save(root, data):
    """Write the settings whole: beside the old file, then swapped, so no reader sees half a file."""
    path = Path(root) / SETTINGS
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=".settings-", suffix=".json")
    with os.fdopen(handle, "w", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)


def doc_gate(root):
    """(mode, problem or None): enforce unless the owner chose warn or off in a readable file."""
    data, problem = load(root)
    if problem:
        return "enforce", problem
    mode = data.get("doc_gate", "enforce")
    if mode not in GATES:
        return "enforce", f"{SETTINGS} doc_gate {mode!r} is not one of {', '.join(GATES)}: the gate enforces"
    return mode, None


def address_problem(url):
    """Why url cannot be a framework address, or None."""
    if not isinstance(url, str) or not url.strip() or len(url) > 2048:
        return "the address must be a nonempty string"
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return "the address is not a valid http:// or https:// URL"
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return "the address must be an http:// or https:// URL with a host"
    if parts.username or parts.password:
        return "the address must not carry credentials; a gateway token goes in AEION_FRAMEWORK_TOKEN"
    if parts.query or parts.fragment:
        return "the address must not carry a query or a fragment"
    try:
        parts.port
    except ValueError:
        return "the address has a port that is not a number from 0 to 65535"
    return None


def framework(root):
    """(address or None, source "env" | "file" | None, problem or None). No address: mode off."""
    env = os.environ.get("AEION_FRAMEWORK_URL")
    if env:
        problem = address_problem(env)
        return (None, "env", f"AEION_FRAMEWORK_URL: {problem}") if problem else (env.strip().rstrip("/"), "env", None)
    data, problem = load(root)
    if problem:
        return None, "file", problem
    url = data.get("framework")
    if url is None:
        return None, None, None
    problem = address_problem(url)
    if problem:
        return None, "file", f"{SETTINGS} framework: {problem}; framework mode is off"
    return url.strip().rstrip("/"), "file", None


def supported(version):
    """Whether an aeion-framework version is inside the supported range."""
    try:
        major, minor = (int(part) for part in str(version).split("-")[0].split(".")[:2])
    except ValueError:
        return False
    return SUPPORTED[0] <= (major, minor) < SUPPORTED[1]


class InsecureToken(ValueError):
    """The gateway token would leave this machine in clear text."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib copies the Authorization header to a redirect's target, whatever its host or scheme.
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(_NoRedirect)
# This machine is reached directly: a proxy from the environment would get the token in clear text and
# could answer as if it were the service.
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)


def loopback(url):
    """Whether url names this machine."""
    host = urlsplit(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def token_allowed(url):
    """Whether a gateway token may go to url: over https, or to this machine."""
    return urlsplit(url).scheme == "https" or loopback(url)


def request(url, timeout=REQUEST_SECONDS):
    """GET url as JSON: (status, body or None, Retry-After seconds or None). The gateway token, when
    set, travels in a header, only over https or to this machine, which is never reached through a
    proxy; a redirect is answered, not followed. An answer that is not HTTP raises OSError."""
    headers = {"Accept": "application/json, application/problem+json"}
    token = os.environ.get("AEION_FRAMEWORK_TOKEN")
    if token:
        if not token_allowed(url):
            raise InsecureToken("AEION_FRAMEWORK_TOKEN is sent only over https or to this machine; "
                                "give the gateway an https:// address")
        headers["Authorization"] = f"Bearer {token}"
    opener = DIRECT if loopback(url) else OPENER
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=timeout) as answer:
            status, raw, retry = answer.status, answer.read(1_048_576), None
    except urllib.error.HTTPError as error:
        status, raw, retry = error.code, b"", error.headers.get("Retry-After")
        try:
            raw = error.read(65_536)
        except (OSError, http.client.HTTPException):
            # The status stands; a body that breaks is no body.
            pass
        finally:
            error.close()
    except http.client.HTTPException as error:
        # Every caller treats OSError as unreachable; this one would end a hook instead.
        raise OSError(f"not an HTTP answer ({type(error).__name__})") from None
    retry = int(retry) if isinstance(retry, str) and retry.strip().isdigit() else None
    try:
        return status, json.loads(raw.decode("utf-8")) if raw else None, retry
    except (UnicodeDecodeError, ValueError):
        return status, None, retry


def health(url, timeout=REQUEST_SECONDS):
    """(version or None, problem or None) from the service's readiness probe; unknown is never ready."""
    try:
        status, body, _ = request(f"{url}/health/ready", timeout)
    except InsecureToken as error:
        return None, str(error)
    except (OSError, ValueError) as error:
        return None, f"{url} is unreachable ({type(error).__name__})"
    if status != 200 or not isinstance(body, dict):
        return None, f"{url}/health/ready answered {status}, not a ready service"
    version = body.get("version")
    if not isinstance(version, str) or not supported(version):
        low, high = SUPPORTED
        return None, (f"{url} runs aeion-framework {version!r}; this template supports "
                      f"{low[0]}.{low[1]} up to {high[0]}.{high[1]} (tested {TESTED})")
    return version, None


def cached_health(root, url, now=None):
    """health(), remembered for ten minutes so a session start never waits on the network twice."""
    now = time.time() if now is None else now
    path = Path(root) / HEALTH_CACHE
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached.get("url") == url and 0 <= now - cached.get("at", -HEALTH_SECONDS) < HEALTH_SECONDS:
            return cached.get("version"), cached.get("problem")
    except (OSError, ValueError, AttributeError):
        pass
    version, problem = health(url)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"url": url, "at": now, "version": version, "problem": problem}), encoding="utf-8")
    except OSError:
        pass
    return version, problem


def annotated(root, limit=5000):
    """Whether the project's code names aeion-framework requirements (@req ID). Markdown and the passive
    skills pool are prose, never annotations. An unreadable tree answers no: this only drives a hint."""
    root = Path(root)
    try:
        if git_active(root):
            done = subprocess.run(["git", "grep", "-qIE", REQ_GIT, "--", ".", ":!*.md", ":!skills/"],
                                  cwd=root, capture_output=True, timeout=5)
            return done.returncode == 0
        for count, relative in enumerate(project_files(root)):
            if count >= limit:
                return False
            if relative.endswith(".md") or relative.startswith("skills/"):
                continue
            try:
                with open(root / relative, "rb") as stream:
                    if req_ids(stream.read(65_536).decode("utf-8", "ignore")):
                        return True
            except OSError:
                continue
    except (OSError, subprocess.SubprocessError):
        return False
    return False

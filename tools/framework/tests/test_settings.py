#!/usr/bin/env python3
"""The owner's settings: the reader every hook shares, the tools/aeion-settings switch and the
session-start line, against a local stand-in for the aeion-framework readiness probe."""
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / ".claude/hooks"))
import aeion_settings as settings  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fake_service import Service  # noqa: E402

CLI = ROOT / "tools/aeion-settings"
# Built by concatenation so the template's own code never carries an annotation.
ANNOTATION = "# " + "@req" + " CORE-001\n"


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.service = Service()
        self.addCleanup(self.service.close)
        # The tests set the environment they need; the owner's own address never leaks in.
        clean = {k: v for k, v in os.environ.items() if k not in ("AEION_FRAMEWORK_URL", "AEION_FRAMEWORK_TOKEN")}
        patcher = patch.dict(os.environ, clean, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, text):
        (self.root / ".aeion").mkdir(exist_ok=True)
        (self.root / settings.SETTINGS).write_text(text, encoding="utf-8")

    def cli(self, *args, env=None):
        environment = {k: v for k, v in os.environ.items() if k not in ("AEION_FRAMEWORK_URL", "AEION_FRAMEWORK_TOKEN")}
        return subprocess.run([sys.executable, str(CLI), "--root", str(self.root), *args], capture_output=True, text=True,
                              stdin=subprocess.DEVNULL, env={**environment, **(env or {})}, timeout=30)

    # The reader.
    def test_a_missing_file_is_empty_and_valid(self):
        self.assertEqual(settings.load(self.root), ({}, None))
        self.assertEqual(settings.doc_gate(self.root), ("enforce", None))
        self.assertEqual(settings.framework(self.root), (None, None, None))

    def test_an_unreadable_file_fails_closed(self):
        for text in ("{", "[]", "\"warn\""):
            self.write(text)
            mode, problem = settings.doc_gate(self.root)
            self.assertEqual(mode, "enforce")
            self.assertIn(settings.SETTINGS, problem)
            url, _, problem = settings.framework(self.root)
            self.assertIsNone(url)
            self.assertIn("framework mode is off", problem)

    def test_the_gate_takes_only_its_three_modes(self):
        for mode in settings.GATES:
            self.write(json.dumps({"doc_gate": mode}))
            self.assertEqual(settings.doc_gate(self.root), (mode, None))
        for mode in ("OFF", "", None, 0, "disabled"):
            self.write(json.dumps({"doc_gate": mode}))
            gate, problem = settings.doc_gate(self.root)
            self.assertEqual(gate, "enforce", mode)
            self.assertIn("the gate enforces", problem)

    def test_an_address_is_an_http_url_without_secrets(self):
        for url in ("http://127.0.0.1:8787", "http://[::1]:8787", "https://axiom.example.invalid/base", " http://h:1/ "):
            self.assertIsNone(settings.address_problem(url), url)
        for url in ("", " ", None, 7, "ftp://h", "h:8787", "http://", "http://u:p@h", "http://u@h", "http://h/?a=1",
                    "http://h/#x", "http://h/" + "a" * 2048, "file:///etc/hosts", "javascript:alert(1)"):
            self.assertIsNotNone(settings.address_problem(url), url)

    def test_a_malformed_address_is_refused_without_a_traceback(self):
        for address in ("http://[::1", "http://[invalid]/"):
            with self.subTest(address=address):
                result = self.cli("framework", address)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("refused", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(self.service.seen, [])
                self.assertFalse((self.root / settings.SETTINGS).exists())
                self.write(json.dumps({"framework": address}))
                url, source, problem = settings.framework(self.root)
                self.assertEqual((url, source), (None, "file"))
                self.assertIsNotNone(problem)
                (self.root / settings.SETTINGS).unlink()
                result = self.cli(env={"AEION_FRAMEWORK_URL": address})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("framework: off (AEION_FRAMEWORK_URL:", result.stdout)
                self.assertNotIn("Traceback", result.stderr)

    def test_the_address_is_the_switch(self):
        self.write(json.dumps({"framework": "http://127.0.0.1:8787/"}))
        self.assertEqual(settings.framework(self.root), ("http://127.0.0.1:8787", "file", None))
        self.write(json.dumps({"framework": "http://u:p@h"}))
        url, source, problem = settings.framework(self.root)
        self.assertEqual((url, source), (None, "file"))
        self.assertIn("credentials", problem)

    def test_the_environment_wins_over_the_file(self):
        self.write(json.dumps({"framework": "http://127.0.0.1:1"}))
        with patch.dict(os.environ, {"AEION_FRAMEWORK_URL": "http://10.0.0.2:8787/"}):
            self.assertEqual(settings.framework(self.root), ("http://10.0.0.2:8787", "env", None))
        with patch.dict(os.environ, {"AEION_FRAMEWORK_URL": "nope"}):
            url, source, problem = settings.framework(self.root)
            self.assertEqual((url, source), (None, "env"))
            self.assertIn("AEION_FRAMEWORK_URL", problem)

    def test_the_supported_range(self):
        for version in ("1.1.0", "1.1.9", "1.9.0", "1.1.9-rc1", "1.2"):
            self.assertTrue(settings.supported(version), version)
        for version in ("1.0.9", "0.3.0", "2.0.0", "10.1.0", "", "x", "1", None):
            self.assertFalse(settings.supported(version), version)

    # The readiness probe.
    def test_a_ready_supported_service(self):
        self.assertEqual(settings.health(self.service.url), (settings.TESTED, None))

    def test_a_service_that_is_not_ready_or_too_old_or_absent(self):
        self.service.set("/health/ready", 503, {"code": "NOT_READY", "detail": "starting"})
        self.assertIn("503", settings.health(self.service.url)[1])
        self.service.set("/health/ready", 200, {"status": "ready", "version": "1.0.4"})
        version, problem = settings.health(self.service.url)
        self.assertIsNone(version)
        self.assertIn(f"tested {settings.TESTED}", problem)
        self.service.set("/health/ready", 200, ["not", "an", "object"])
        self.assertIsNone(settings.health(self.service.url)[0])
        version, problem = settings.health("http://127.0.0.1:9")
        self.assertIsNone(version)
        self.assertIn("unreachable", problem)

    def test_the_token_travels_only_in_the_header(self):
        settings.health(self.service.url)
        self.assertIsNone(self.service.seen[-1][1])
        with patch.dict(os.environ, {"AEION_FRAMEWORK_TOKEN": "t0ken"}):
            settings.health(self.service.url)
        self.assertEqual(self.service.seen[-1], ("/health/ready", "Bearer t0ken"))

    def test_a_redirect_is_never_followed(self):
        # A redirect would carry the token to wherever it points, another host or plain http included.
        self.service.set("/health/ready", 302, "", {"Location": self.service.url + "/elsewhere"})
        self.service.set("/elsewhere", 200, {"status": "ready", "version": settings.TESTED})
        with patch.dict(os.environ, {"AEION_FRAMEWORK_TOKEN": "t0ken"}):
            version, problem = settings.health(self.service.url)
        self.assertIsNone(version)
        self.assertIn("answered 302", problem)
        self.assertEqual([path for path, _ in self.service.seen], ["/health/ready"])

    def test_the_token_goes_only_over_https_or_to_this_machine(self):
        with patch.dict(os.environ, {"AEION_FRAMEWORK_TOKEN": "t0ken"}):
            for url in ("http://axiom.example:8000", "http://10.0.0.2"):
                version, problem = settings.health(url)
                self.assertIsNone(version)
                self.assertIn("AEION_FRAMEWORK_TOKEN is sent only over https", problem)
        for url in ("https://axiom.example", "http://localhost:8000", "http://[::1]:8000", self.service.url):
            self.assertTrue(settings.token_allowed(url), url)
        self.assertEqual(self.service.seen, [])

    def test_this_machine_is_never_reached_through_a_proxy(self):
        # A proxy would get the token in clear text and answer as if it were the service.
        proxy = Service()
        self.addCleanup(proxy.close)
        # A fresh process, as a hook is: urllib reads the proxy variables when the opener is built.
        env = {k: v for k, v in os.environ.items() if k.lower() != "no_proxy"}
        env.update({"AEION_FRAMEWORK_TOKEN": "t0ken", "http_proxy": proxy.url, "HTTP_PROXY": proxy.url})
        probe = ("import sys; sys.path.insert(0, sys.argv[1]); import aeion_settings as s; "
                 "print(s.health(sys.argv[2])); print(s.health(sys.argv[3]))")
        done = subprocess.run([sys.executable, "-c", probe, str(ROOT / ".claude/hooks"), "http://127.0.0.1:9",
                               self.service.url], capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("unreachable", done.stdout.splitlines()[0])
        self.assertEqual(done.stdout.splitlines()[1], repr((settings.TESTED, None)))
        self.assertEqual(proxy.seen, [])
        self.assertEqual(self.service.seen, [("/health/ready", "Bearer t0ken")])

    def test_an_address_that_http_cannot_use_is_unreachable_never_a_crash(self):
        self.assertIn("port", settings.address_problem("http://127.0.0.1:87a7"))
        self.assertIn("port", settings.address_problem("http://127.0.0.1:99999"))
        self.assertIn("unreachable", settings.health("http://127.0.0.1:87a7")[1])
        # A port that answers something other than HTTP, then an error status whose body breaks.
        for reply, expected in ((b"hello, not http\r\n\r\n", "unreachable"),
                                (b"HTTP/1.1 503 Service Unavailable\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n", "503")):
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            self.addCleanup(listener.close)

            def answer(listener=listener, reply=reply):
                connection, _ = listener.accept()
                with connection:
                    connection.recv(1024)
                    connection.sendall(reply)
            threading.Thread(target=answer, daemon=True).start()
            version, problem = settings.health(f"http://127.0.0.1:{listener.getsockname()[1]}")
            self.assertIsNone(version)
            self.assertIn(expected, problem)

    def test_the_probe_is_remembered_ten_minutes_per_address(self):
        self.assertEqual(settings.cached_health(self.root, self.service.url, now=1000), (settings.TESTED, None))
        self.assertEqual(settings.cached_health(self.root, self.service.url, now=1000 + settings.HEALTH_SECONDS - 1),
                         (settings.TESTED, None))
        self.assertEqual(len(self.service.seen), 1)
        settings.cached_health(self.root, self.service.url, now=1000 + settings.HEALTH_SECONDS)
        self.assertEqual(len(self.service.seen), 2)
        # Another address, or a clock that went back, asks again.
        settings.cached_health(self.root, self.service.url + "/", now=1000 + settings.HEALTH_SECONDS)
        settings.cached_health(self.root, self.service.url, now=10)
        self.assertEqual(len(self.service.seen), 4)
        (self.root / settings.HEALTH_CACHE).write_text("{", encoding="utf-8")
        self.assertEqual(settings.cached_health(self.root, self.service.url, now=1000), (settings.TESTED, None))

    # The @req hint.
    def test_every_annotation_form_the_framework_reads(self):
        mark = "@" + "req"
        cases = {f"# {mark} REQ-005 REQ-006 REQ-009\n": ["REQ-005", "REQ-006", "REQ-009"],
                 f"// {mark}: REQ-005\n": ["REQ-005"], f"# {mark}(REQ-005, REQ-006)\n# REQ-007\n": ["REQ-005", "REQ-006"],
                 f"# {mark} REQ-005 and REQ-006\n": ["REQ-005"], f"# {mark} A_B-123456 A-1234567\n": ["A_B-123456"],
                 f"# {mark}uired X-001\n": [], f"# {mark}\n# REQ-001\n": [], f"# {mark} req-001\n": [],
                 f"# {mark} REQ-001\n# {mark} REQ-001 REQ-002\n": ["REQ-001", "REQ-002"]}
        for text, ids in cases.items():
            self.assertEqual(settings.req_ids(text), ids, text)

    def test_annotations_are_found_in_code_only(self):
        for git in (False, True):
            with self.subTest(git=git), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / "notes.md").write_text(ANNOTATION)
                (root / "skills/x").mkdir(parents=True)
                (root / "skills/x/run.py").write_text(ANNOTATION)
                (root / "src").mkdir()
                (root / "src/app.py").write_text("x = 1  # @req is a word here\n")
                self.track(root, git)
                self.assertFalse(settings.annotated(root))
                (root / "src/app.py").write_text(ANNOTATION)
                self.track(root, git)
                self.assertTrue(settings.annotated(root))

    @staticmethod
    def track(root, git):
        if git:
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)

    # The switch.
    def test_show_names_each_setting_and_its_source(self):
        result = self.cli()
        self.assertEqual(result.returncode, 0)
        self.assertIn("doc gate: enforce", result.stdout)
        self.assertIn("framework: off (no API address", result.stdout)
        result = self.cli(env={"AEION_FRAMEWORK_URL": "http://10.0.0.2:8787"})
        self.assertIn("framework: on → http://10.0.0.2:8787 (from AEION_FRAMEWORK_URL)", result.stdout)

    def test_the_gate_is_saved_beside_other_settings(self):
        self.write(json.dumps({"framework": "http://127.0.0.1:8787"}))
        result = self.cli("doc-gate", "warn")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / settings.SETTINGS).read_text()),
                         {"doc_gate": "warn", "framework": "http://127.0.0.1:8787"})
        self.assertEqual(stat.S_IMODE((self.root / settings.SETTINGS).stat().st_mode), 0o644)
        self.assertEqual(self.cli("doc-gate", "never").returncode, 2)
        self.assertEqual(sorted(p.name for p in (self.root / ".aeion").iterdir()), ["settings.json"])

    def test_connect_saves_a_ready_service_and_prints_the_mcp_line(self):
        result = self.cli("framework", self.service.url + "/")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / settings.SETTINGS).read_text()), {"framework": self.service.url})
        self.assertIn(f"aeion-framework {settings.TESTED}, ready", result.stdout)
        self.assertIn(f"claude mcp add --transport http aeion-axiom {self.service.url}/mcp/ --scope local", result.stdout)
        result = self.cli("framework", "off")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads((self.root / settings.SETTINGS).read_text()), {})

    def test_connect_forgets_a_probe_cached_while_the_service_was_down(self):
        (self.root / ".aeion").mkdir()
        (self.root / settings.HEALTH_CACHE).write_text(json.dumps(
            {"url": self.service.url, "at": time.time(), "version": None, "problem": "unreachable"}), encoding="utf-8")
        self.assertEqual(self.cli("framework", self.service.url).returncode, 0)
        self.assertEqual(settings.cached_health(self.root, self.service.url), (settings.TESTED, None))

    def test_connect_refuses_and_saves_nothing(self):
        self.service.set("/health/ready", 200, {"status": "ready", "version": "0.3.0"})
        for args in ((self.service.url,), ("http://127.0.0.1:9",), ("http://u:p@127.0.0.1:1",), ("ftp://h",)):
            result = self.cli("framework", *args)
            self.assertEqual(result.returncode, 1, args)
            self.assertIn("refused", result.stderr)
            self.assertFalse((self.root / settings.SETTINGS).exists(), args)
        # Without a terminal, no address is ever guessed.
        result = self.cli("framework")
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / settings.SETTINGS).exists())

    def test_session_start_names_a_ready_service(self):
        repo = self.root / "repo"
        for rel in (".claude/hooks/session-start.py", ".claude/hooks/project_files.py", ".claude/hooks/aeion_settings.py",
                    "tools/repo-health/repo-health"):
            (repo / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / rel, repo / rel)
        (repo / ".aeion").mkdir()
        (repo / settings.SETTINGS).write_text(json.dumps({"framework": self.service.url, "doc_gate": "off"}))
        environment = {k: v for k, v in os.environ.items() if k not in ("AEION_FRAMEWORK_URL", "AEION_FRAMEWORK_TOKEN")}
        result = subprocess.run([sys.executable, str(repo / ".claude/hooks/session-start.py")], capture_output=True,
                                text=True, cwd=repo, env=environment, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"doc gate: off; framework: on → {self.service.url} (aeion-framework {settings.TESTED}, ready)",
                      result.stdout)


if __name__ == "__main__":
    unittest.main()

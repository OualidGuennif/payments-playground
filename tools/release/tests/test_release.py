#!/usr/bin/env python3
"""Run the real release tool on disposable plain folders (no git needed)."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "release"
HEAD = "# Changelog\n\n## [Unreleased]\n"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def release(self, *args):
        return subprocess.run([sys.executable, str(TOOL), "--root", str(self.root), "--date", "2026-10-28", *args],
                              capture_output=True, text=True, timeout=10)

    def write(self, version, changelog):
        (self.root / "VERSION").write_text(version)
        (self.root / "CHANGELOG.md").write_text(changelog)

    def test_minor_release_dates_unreleased_and_keeps_history(self):
        self.write("1.2.0\n", HEAD + "\n### Added\n- Develop flow.\n\n## [1.2.0] - 2026-10-01\n\n- Old.\n")
        result = self.release("minor")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "VERSION").read_text(), "1.3.0\n")
        self.assertEqual((self.root / "CHANGELOG.md").read_text(),
                         HEAD + "\n## [1.3.0] - 2026-10-28\n\n### Added\n- Develop flow.\n\n## [1.2.0] - 2026-10-01\n\n- Old.\n")
        self.assertTrue(result.stdout.startswith("Release v1.3.0\n\n### Added\n- Develop flow."))
        notes = self.release("--notes", "1.3.0")
        self.assertEqual(notes.stdout, "### Added\n- Develop flow.\n")

    def test_major_and_patch_bumps(self):
        self.write("1.3.4\n", HEAD + "- Fix.\n")
        self.assertEqual(self.release("patch").returncode, 0)
        self.assertEqual((self.root / "VERSION").read_text(), "1.3.5\n")
        self.write("1.3.4\n", HEAD + "- Break.\n")
        self.assertEqual(self.release("major").returncode, 0)
        self.assertEqual((self.root / "VERSION").read_text(), "2.0.0\n")

    def test_refusals_change_nothing(self):
        self.write("1.2.0\n", HEAD + "\n## [1.2.0] - 2026-10-01\n\n- Old.\n")
        self.assertIn("no lines under", self.release("minor").stderr)
        self.assertEqual((self.root / "VERSION").read_text(), "1.2.0\n")
        self.write("v1.2\n", HEAD + "- Fix.\n")
        self.assertIn("not MAJOR.MINOR.PATCH", self.release("patch").stderr)
        self.assertEqual(self.release("--notes", "9.9.9").returncode, 1)
        # A repeated run never writes a second section for the same version.
        self.write("1.2.0\n", HEAD + "- Fix.\n\n## [1.3.0] - 2026-10-01\n\n- Cut.\n")
        self.assertIn("already has a section for 1.3.0", self.release("minor").stderr)
        self.assertEqual((self.root / "VERSION").read_text(), "1.2.0\n")
        (self.root / "VERSION").unlink()
        missing = self.release("minor")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("FAIL VERSION and CHANGELOG.md", missing.stderr)


    def test_new_project_keeps_only_the_adapt_task(self):
        self.write("1.4.0\n", "# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [1.4.0] - 2026-10-28\n\n- Old.\n")
        (self.root / "work").mkdir()
        tasks = ("# Current work\n\nHeader.\n\n## Template task — ACTIVE\n- State: template.\n\n"
                 "## Adapt Æion Template to this project — ACTIVE\n- Owner decision: <date>, started.\n- Next: adapt.\n")
        (self.root / "work/current.md").write_text(tasks)
        # A project's own spec and docs are never the reset's to touch.
        (self.root / "knowledge/spec").mkdir(parents=True)
        (self.root / "knowledge/spec/spec.json").write_text('{"kept": true}')
        first = self.release("--new-project")
        self.assertEqual(first.returncode, 0)
        self.assertEqual((self.root / "knowledge/spec/spec.json").read_text(), '{"kept": true}')
        expected = ("# Current work\n\nHeader.\n\n## Adapt Æion Template to this project — ACTIVE\n"
                    "- Owner decision: 2026-10-28, started.\n- Next: adapt.\n")
        self.assertEqual((self.root / "work/current.md").read_text(), expected)
        self.assertEqual((self.root / "CHANGELOG.md").read_text(), "# Changelog\n\nIntro.\n\n## [Unreleased]\n")
        self.assertEqual((self.root / "VERSION").read_text(), "0.1.0\n")
        # template-update reads the template release from the marker, never from the application's VERSION.
        self.assertEqual((self.root / ".aeion-template").read_text(), "v1.4.0\n")
        # A second run changes nothing.
        self.assertEqual(self.release("--new-project").returncode, 0)
        self.assertEqual((self.root / "work/current.md").read_text(), expected)
        self.assertEqual((self.root / ".aeion-template").read_text(), "v1.4.0\n")

    def test_new_project_refuses_in_the_template_clone(self):
        self.write("1.4.0\n", HEAD)
        (self.root / "work").mkdir()
        (self.root / "work/current.md").write_text("# Current work\n\n## Adapt Æion Template to this project — ACTIVE\n- x\n")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "remote", "add", "origin",
                        "https://github.com/OualidGuennif/aeion-template.git"], check=True)
        # A clone made before the rename keeps the old origin until its owner changes it.
        for origin in ("https://github.com/OualidGuennif/aeion-template.git", "git@github.com:OualidGuennif/aeion-factory.git"):
            subprocess.run(["git", "-C", str(self.root), "remote", "set-url", "origin", origin], check=True)
            result = self.release("--new-project")
            self.assertEqual(result.returncode, 1, origin)
            self.assertIn("own clone", result.stderr)
            self.assertEqual((self.root / "VERSION").read_text(), "1.4.0\n")
            self.assertFalse((self.root / ".aeion-template").exists())


if __name__ == "__main__":
    unittest.main()

import { test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assert, assertEquals } from "../../testing/assert.ts";
import { checkKnowledge } from "./knowledge-check.ts";

const NOW = new Date("2026-10-09T12:00:00Z");

const CONCEPT = `---
type: Architecture
title: Overview
description: "What the system is."
status: stable
generated:
  by: test
  at: 2026-10-09T00:00:00Z
sources:
  - id: code
    resource: ../../README.md
    title: Readme
---

# Overview
`;

/** A minimal valid repository: AGENTS.md, a CLAUDE.md symlink and one concept. */
function fixture(overrides: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "knowledge-check-"));
  const files: Record<string, string | null> = {
    "AGENTS.md": "# Agents\n\nSee [the bundle](knowledge/index.md).\n",
    "README.md": "# Readme\n",
    "knowledge/index.md":
      '---\nokf_version: "0.2"\n---\n\n# Bundle\n\n- [Architecture](architecture/index.md)\n',
    "knowledge/architecture/index.md": "# Architecture\n\n- [Overview](overview.md)\n",
    "knowledge/architecture/overview.md": CONCEPT,
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (!("CLAUDE.md" in overrides)) symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
  return root;
}

function failures(root: string): string[] {
  try {
    return checkKnowledge(root, NOW).errors;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a valid bundle passes", () => {
  assertEquals(failures(fixture()), []);
});

test("CLAUDE.md may be the @AGENTS.md pointer but not an independent copy", () => {
  assertEquals(failures(fixture({ "CLAUDE.md": "@AGENTS.md\n" })), []);
  const copy = failures(fixture({ "CLAUDE.md": "# Agents\n" }));
  assert(copy.some((error) => error.includes("CLAUDE.md")));
});

test("an oversized AGENTS.md fails", () => {
  const errors = failures(fixture({ "AGENTS.md": "line\n".repeat(250) }));
  assert(errors.some((error) => error.includes("AGENTS.md has")));
});

test("invalid YAML and missing metadata fail", () => {
  assert(
    failures(
      fixture({ "knowledge/architecture/overview.md": "---\ntitle: [unclosed\n---\n" }),
    ).some((error) => error.includes("invalid YAML")),
  );
  const missing = failures(
    fixture({
      "knowledge/architecture/overview.md": CONCEPT.replace(/description: .*\n/, ""),
    }),
  );
  assert(missing.some((error) => error.includes("missing description")));
});

test("a factual concept without sources fails", () => {
  const errors = failures(
    fixture({
      "knowledge/architecture/overview.md": CONCEPT.replace(/sources:[\s\S]*?title: Readme\n/, ""),
    }),
  );
  assert(errors.some((error) => error.includes("needs sources")));
});

test("a source path that no longer exists fails", () => {
  const errors = failures(
    fixture({
      "knowledge/architecture/overview.md": CONCEPT.replace(
        "resource: ../../README.md",
        "resource: ../../gone.ts",
      ),
    }),
  );
  assert(errors.some((error) => error.includes("gone.ts")));
});

test("a broken internal link fails", () => {
  const errors = failures(
    fixture({
      "knowledge/architecture/overview.md": `${CONCEPT}\nSee [nothing](missing.md).\n`,
    }),
  );
  assert(errors.some((error) => error.includes("broken link -> missing.md")));
});

test("an index that omits a stable concept fails", () => {
  const errors = failures(fixture({ "knowledge/architecture/index.md": "# Architecture\n" }));
  assert(errors.some((error) => error.includes("does not list overview.md")));
});

test("a stable concept past stale_after must say STALE", () => {
  const stale = CONCEPT.replace("status: stable", "status: stable\nstale_after: 2026-10-01");
  assert(
    failures(fixture({ "knowledge/architecture/overview.md": stale })).some((error) =>
      error.includes("stale_after has passed"),
    ),
  );
  const marked = stale.replace("# Overview", "# Overview\n\n> STALE: re-verify.");
  assertEquals(failures(fixture({ "knowledge/architecture/overview.md": marked })), []);
});

test("deprecated needs an existing superseded_by, and scopes are unique", () => {
  const deprecated = CONCEPT.replace("status: stable", "status: deprecated");
  assert(
    failures(fixture({ "knowledge/architecture/overview.md": deprecated })).some((error) =>
      error.includes("superseded_by"),
    ),
  );
  const scoped = CONCEPT.replace("status: stable", "status: stable\nscope: overview");
  const errors = failures(
    fixture({
      "knowledge/architecture/overview.md": scoped,
      "knowledge/architecture/other.md": scoped,
      "knowledge/architecture/index.md": "# A\n\n- [O](overview.md)\n- [P](other.md)\n",
    }),
  );
  assert(errors.some((error) => error.includes('scope "overview"')));
});

test("factory caps: description, component sections, verified and work state", () => {
  const longDescription = CONCEPT.replace(
    /description: .*\n/,
    `description: "${"x".repeat(251)}"\n`,
  );
  assert(
    failures(fixture({ "knowledge/architecture/overview.md": longDescription })).some((error) =>
      error.includes("description over 250 characters"),
    ),
  );

  const component = CONCEPT.replace("type: Architecture", "type: Component");
  assert(
    failures(fixture({ "knowledge/architecture/overview.md": component })).some((error) =>
      error.includes("Component lacks '## Intent'"),
    ),
  );

  const verified = CONCEPT.replace(
    "\n---\n\n# Overview",
    `\nverified:\n  - at: 2026-10-31\n    check: "${"y".repeat(301)}"\n---\n\n# Overview`,
  );
  assert(
    failures(fixture({ "knowledge/architecture/overview.md": verified })).some((error) =>
      error.includes("over 300 characters"),
    ),
  );

  const four = CONCEPT.replace(
    "\n---\n\n# Overview",
    "\nverified:\n" + "  - at: 2026-10-31\n    check: a\n".repeat(4) + "---\n\n# Overview",
  );
  assert(
    failures(fixture({ "knowledge/architecture/overview.md": four })).some((error) =>
      error.includes("4 verified entries"),
    ),
  );

  const fields = [
    "- Owner decision: x",
    "- State: x",
    "- Next: x",
    "- Blocker: none.",
    "- Evidence: x",
  ].join("\n");
  assertEquals(failures(fixture({ "work/current.md": `## A — ACTIVE\n${fields}\n` })), []);
  assert(
    failures(fixture({ "work/current.md": "## A — ACTIVE\n- State: x\n" })).some((error) =>
      error.includes("lacks '- Owner decision:'"),
    ),
  );
  assert(
    failures(fixture({ "work/current.md": `## A — ACTIVE\n${fields}\n${"- x\n".repeat(6)}` })).some(
      (error) => error.includes("over 10 lines"),
    ),
  );
});

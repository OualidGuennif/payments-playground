/**
 * Offline validator for the knowledge/ bundle (Open Knowledge Format v0.2) and
 * the root agent instructions. No network, no credentials.
 *
 *   deno task knowledge:check
 *   deno run --allow-read tools/knowledge/knowledge-check.ts --root <dir>   (tests)
 *
 * Exit 0 when every required check passes (warnings may print), 1 otherwise.
 */
import { parse as parseYaml } from "@std/yaml";
import { dirname, join, relative, resolve } from "@std/path";

const VALID_STATUS = new Set(["draft", "stable", "deprecated"]);
// Concepts that make factual or normative claims must say where they come from.
const SOURCED_TYPES = new Set([
  "Architecture",
  "Component",
  "Decision",
  "Policy",
  "Runbook",
  "Current State",
]);
const AGENTS_MAX_LINES = 120;
const AGENTS_MAX_BYTES = 20 * 1024;
const STALE_MARKER = /\bSTALE\b/;

export interface Report {
  errors: string[];
  warnings: string[];
}

interface Concept {
  path: string;
  meta: Record<string, unknown>;
  body: string;
}

function splitFrontmatter(text: string): { meta?: Record<string, unknown>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { body: text };
  const meta = parseYaml(match[1]);
  return {
    meta: meta && typeof meta === "object" ? meta as Record<string, unknown> : undefined,
    body: text.slice(match[0].length),
  };
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) files.push(...walk(path));
    else if (entry.isFile && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Relative Markdown links only: URLs, mailto and pure anchors are not files. */
function internalLinks(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:[a-z]+:|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]))
    .filter(Boolean);
}

function checkLinks(file: string, text: string, root: string, report: Report) {
  for (const target of internalLinks(text)) {
    if (!exists(resolve(dirname(file), target))) {
      report.errors.push(`${relative(root, file)}: broken link -> ${target}`);
    }
  }
}

function checkAgentsFiles(root: string, report: Report) {
  const agents = join(root, "AGENTS.md");
  if (!exists(agents)) {
    report.errors.push("AGENTS.md is missing");
    return;
  }
  const text = Deno.readTextFileSync(agents);
  const lines = text.split("\n").length;
  if (lines > AGENTS_MAX_LINES) {
    report.errors.push(`AGENTS.md has ${lines} lines (max ${AGENTS_MAX_LINES})`);
  }
  if (new TextEncoder().encode(text).length > AGENTS_MAX_BYTES) {
    report.errors.push(`AGENTS.md exceeds ${AGENTS_MAX_BYTES} bytes`);
  }
  checkLinks(agents, text, root, report);

  const claude = join(root, "CLAUDE.md");
  let info: Deno.FileInfo;
  try {
    info = Deno.lstatSync(claude);
  } catch {
    report.errors.push("CLAUDE.md is missing (symlink it to AGENTS.md)");
    return;
  }
  if (info.isSymlink) {
    if (resolve(root, Deno.readLinkSync(claude)) !== resolve(agents)) {
      report.errors.push("CLAUDE.md is a symlink but not to AGENTS.md");
    }
  } else if (Deno.readTextFileSync(claude).trim() !== "@AGENTS.md") {
    report.errors.push("CLAUDE.md must be a symlink to AGENTS.md or the line @AGENTS.md");
  }
}

function readConcept(path: string, root: string, report: Report): Concept | undefined {
  let split: ReturnType<typeof splitFrontmatter>;
  try {
    split = splitFrontmatter(Deno.readTextFileSync(path));
  } catch (error) {
    report.errors.push(`${relative(root, path)}: invalid YAML frontmatter (${error})`);
    return undefined;
  }
  if (!split.meta) {
    report.errors.push(`${relative(root, path)}: missing YAML frontmatter`);
    return undefined;
  }
  return { path, meta: split.meta, body: split.body };
}

function checkConcept(concept: Concept, root: string, report: Report, now: Date) {
  const where = relative(root, concept.path);
  const { meta } = concept;
  for (const field of ["type", "title", "description", "status"]) {
    if (typeof meta[field] !== "string" || !(meta[field] as string).trim()) {
      report.errors.push(`${where}: missing ${field}`);
    }
  }
  const generated = meta.generated as Record<string, unknown> | undefined;
  if (!generated?.by || !generated?.at) {
    report.errors.push(`${where}: generated.by and generated.at are required`);
  }
  if (typeof meta.status === "string" && !VALID_STATUS.has(meta.status)) {
    report.errors.push(`${where}: status must be draft, stable or deprecated`);
  }
  const sources = Array.isArray(meta.sources) ? meta.sources as Record<string, unknown>[] : [];
  if (SOURCED_TYPES.has(String(meta.type)) && sources.length === 0) {
    report.errors.push(`${where}: a ${meta.type} concept needs sources`);
  }
  for (const source of sources) {
    const resource = String(source.resource ?? "");
    if (!resource) {
      report.errors.push(`${where}: a source has no resource`);
    } else if (
      !/^[a-z][a-z0-9+.-]*:/i.test(resource) &&
      !exists(resolve(dirname(concept.path), resource.split("#")[0]))
    ) {
      report.errors.push(`${where}: source path no longer exists -> ${resource}`);
    }
  }
  if (meta.status === "deprecated") {
    const target = String(meta.superseded_by ?? "");
    if (!target || !exists(resolve(dirname(concept.path), target))) {
      report.errors.push(`${where}: deprecated without an existing superseded_by`);
    }
  }
  if (meta.stale_after) {
    const staleAfter = new Date(String(meta.stale_after));
    if (Number.isNaN(staleAfter.getTime())) {
      report.errors.push(`${where}: stale_after is not a date`);
    } else if (staleAfter <= now) {
      const head = concept.body.split("\n").slice(0, 12).join("\n");
      if (meta.status === "stable" && !STALE_MARKER.test(head)) {
        report.errors.push(`${where}: stale_after has passed; re-verify it or mark it STALE`);
      }
    } else if (staleAfter.getTime() - now.getTime() < 14 * 86_400_000) {
      report.warnings.push(`${where}: stale_after is within 14 days`);
    }
  }
  checkLinks(concept.path, concept.body, root, report);
}

function checkIndexes(files: string[], concepts: Concept[], root: string, report: Report) {
  for (const index of files.filter((file) => file.endsWith("/index.md"))) {
    const dir = dirname(index);
    const text = Deno.readTextFileSync(index);
    checkLinks(index, text, root, report);
    const linked = new Set(internalLinks(text).map((target) => resolve(dir, target)));
    for (const concept of concepts) {
      if (dirname(concept.path) !== dir || concept.meta.status !== "stable") continue;
      if (!linked.has(resolve(concept.path))) {
        report.errors.push(
          `${relative(root, index)}: does not list ${relative(dir, concept.path)}`,
        );
      }
    }
  }
}

export function checkKnowledge(root: string, now = new Date()): Report {
  const report: Report = { errors: [], warnings: [] };
  checkAgentsFiles(root, report);
  const bundle = join(root, "knowledge");
  if (!exists(join(bundle, "index.md"))) {
    report.errors.push("knowledge/index.md is missing");
    return report;
  }
  const rootIndex = splitFrontmatter(Deno.readTextFileSync(join(bundle, "index.md")));
  if (String(rootIndex.meta?.okf_version ?? "") !== "0.2") {
    report.errors.push('knowledge/index.md must declare okf_version: "0.2"');
  }
  const files = walk(bundle);
  const concepts = files
    .filter((file) => !file.endsWith("/index.md"))
    .map((file) => readConcept(file, root, report))
    .filter((concept): concept is Concept => Boolean(concept));
  for (const concept of concepts) checkConcept(concept, root, report, now);
  checkIndexes(files, concepts, root, report);

  const scopes = new Map<string, string>();
  for (const concept of concepts) {
    const scope = concept.meta.scope;
    if (typeof scope !== "string" || concept.meta.status !== "stable") continue;
    const other = scopes.get(scope);
    if (other) {
      report.errors.push(`two stable concepts claim scope "${scope}": ${other}, ${concept.path}`);
    }
    scopes.set(scope, concept.path);
  }
  for (const file of ["README.md"]) {
    const path = join(root, file);
    if (exists(path)) checkLinks(path, Deno.readTextFileSync(path), root, report);
  }
  return report;
}

if (import.meta.main) {
  const rootFlag = Deno.args.indexOf("--root");
  const root = rootFlag >= 0
    ? resolve(Deno.args[rootFlag + 1])
    : resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const { errors, warnings } = checkKnowledge(root);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
  for (const error of errors) console.error(`FAIL ${error}`);
  console.log(
    errors.length ? `knowledge-check: ${errors.length} failure(s)` : "knowledge-check: ok",
  );
  Deno.exit(errors.length ? 1 : 0);
}

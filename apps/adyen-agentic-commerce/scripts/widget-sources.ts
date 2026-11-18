// Spec: knowledge/components/adyen-agentic-commerce.md
// The files the built widgets and the plugin package come from, and their hash: the build records
// it, and a test fails when a source changed after the last build (src/server/widgets.test.ts).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const APP = join(import.meta.dir, "..");
export const WIDGETS_DIR = join(APP, "src/widgets");
export const PLUGIN_DIR = join(APP, "plugin/atelier-velune");

function walk(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    })
    .sort();
}

// Tests are not part of what ships.
export const widgetFiles = () => walk(WIDGETS_DIR).filter((p) => !p.endsWith(".test.ts"));
export const pluginFiles = () => walk(PLUGIN_DIR);

export function sourceHash() {
  const hash = createHash("sha256");
  for (const path of [...widgetFiles(), ...pluginFiles(), join(APP, "scripts/build-widgets.ts")]) {
    hash.update(relative(APP, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

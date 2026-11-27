// Spec: knowledge/operations/docker-and-render.md
import { expect, test } from "bun:test";
import { dirname, resolve, sep } from "node:path";
import { Glob } from "bun";

const APP = resolve(import.meta.dir, "..");
const RELATIVE = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

// The image copies this app and tools/build only, not packages/ or testing/: an import by path that
// leaves the app passes every local check and breaks the Render build (v0.10.0).
test("no source file imports a path outside the app", async () => {
  const outside: string[] = [];
  for await (const file of new Glob("src/**/*.{ts,tsx}").scan({ cwd: APP })) {
    const text = await Bun.file(resolve(APP, file)).text();
    for (const [, path] of text.matchAll(RELATIVE)) {
      if (!path) continue;
      const target = resolve(dirname(resolve(APP, file)), path);
      if (!target.startsWith(APP + sep)) outside.push(`${file} -> ${path}`);
    }
  }
  expect(outside).toEqual([]);
});

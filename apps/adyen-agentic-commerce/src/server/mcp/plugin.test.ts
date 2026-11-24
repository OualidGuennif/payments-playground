// The plugin package: exactly its files, this origin's /mcp and nothing else, no app reference and
// no hook, and a ZIP any reader can open (invariant 30).
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import { relative } from "node:path";
import { PLUGIN_DIR, pluginFiles as filesOnDisk } from "../../../scripts/widget-sources";
import { handle } from "../api";
import { ORIGIN } from "../testing/agent";
import { PLUGIN_ZIP_PATH } from "./widgets";

// Reads a stored-entry ZIP through its central directory, checking each entry's CRC-32.
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(method).toBe(0);
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const start =
      offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(Bun.hash.crc32(data) >>> 0).toBe(crc);
    files[name] = new TextDecoder().decode(data);
    at += 46 + nameLength;
  }
  return files;
}

async function download() {
  const response = await handle(new Request(`${ORIGIN}${PLUGIN_ZIP_PATH}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  return unzip(new Uint8Array(await response.arrayBuffer()));
}

const CATEGORIES = new Set([
  "Productivity",
  "Creativity",
  "Developer Tools",
  "Business & Operations",
  "Data & Analytics",
  "Communication",
  "Education & Research",
  "Security",
  "Finance",
  "Healthcare",
  "Travel",
  "Entertainment",
  "Other",
]);

describe("the plugin package", () => {
  test("holds exactly the plugin folder's files, never a hidden one", async () => {
    const files = await download();
    expect(Object.keys(files).sort()).toEqual(
      filesOnDisk()
        .map((p) => `atelier-velune/${relative(PLUGIN_DIR, p)}`)
        .sort(),
    );
    expect(Object.keys(files).sort()).toEqual([
      "atelier-velune/assets/icon.svg",
      "atelier-velune/assets/logo.svg",
      "atelier-velune/mcp.json",
      "atelier-velune/plugin.json",
      "atelier-velune/skills/personal-stylist/SKILL.md",
    ]);
  });

  test("declares schema, OpenAI OAuth CIMD, submission limits, and no app reference or hook", async () => {
    const files = await download();
    const mcp = JSON.parse(files["atelier-velune/mcp.json"]!);
    expect(mcp).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "atelier-velune": {
          type: "streamable-http",
          url: `${ORIGIN}/mcp`,
          extensions: {
            "com.openai": {
              auth: {
                type: "oauth",
                client: { mode: "cimd" },
              },
            },
          },
        },
      },
    });
    const manifest = JSON.parse(files["atelier-velune/plugin.json"]!);
    expect(manifest.name).toBe("atelier-velune");
    expect(manifest.author?.url).toStartWith("https://");
    const ui = manifest.extensions["com.openai"].interface;
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
    expect(CATEGORIES.has(ui.category)).toBe(true);
    expect(ui.supportURL).toStartWith("https://");
    expect(ui.websiteURL).toStartWith("https://");
    expect(ui.privacyPolicyURL).toStartWith("https://");
    expect(ui.termsOfServiceURL).toStartWith("https://");
    expect(Array.isArray(ui.defaultPrompt)).toBe(true);
    expect(ui.defaultPrompt.length).toBeGreaterThanOrEqual(1);
    expect(ui.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const p of ui.defaultPrompt as string[]) {
      expect(p.length).toBeLessThanOrEqual(128);
      expect(p).not.toContain("@");
    }
    const keys = JSON.stringify(manifest);
    expect(keys).not.toMatch(/"apps"|"hooks"|\.app\.json/);
    expect(Object.keys(files).some((n) => /hooks|\.app\.json/.test(n))).toBe(false);
  });

  test("every icon the manifest names is square (>= 48x48) and inside the package", async () => {
    const files = await download();
    const ui = JSON.parse(files["atelier-velune/plugin.json"]!).extensions["com.openai"].interface;
    for (const icon of [ui.logo, ui.composerIcon]) {
      const svg = files[`atelier-velune/${icon.replace(/^\.\//, "")}`] ?? "";
      expect(svg).toContain("<svg");
      const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
      expect(box).toBeTruthy();
      expect(Number(box![1])).toBe(Number(box![2]));
      expect(Number(box![1])).toBeGreaterThanOrEqual(48);
    }
  });
});

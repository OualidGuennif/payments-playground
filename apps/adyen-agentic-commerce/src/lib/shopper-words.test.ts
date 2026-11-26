// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasWords, shopperWords } from "./shopper-words";

// Every refusal code the store's commerce code can raise, read from its source so a new code
// without words fails here rather than reaching a page as an agent's text.
function commerceCodes(): string[] {
  const dir = join(import.meta.dir, "../server/commerce");
  const codes = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.includes(".test.")) continue;
    const source = readFileSync(join(dir, file), "utf8");
    for (const m of source.matchAll(/err\(\s*\d+,\s*"([a-z_]+)"/g)) codes.add(m[1] as string);
    for (const m of source.matchAll(/code: "([a-z_]+)"/g)) codes.add(m[1] as string);
  }
  return [...codes].sort();
}

describe("shopper words", () => {
  test("every code the commerce code raises has its own sentence", () => {
    const codes = commerceCodes();
    expect(codes.length).toBeGreaterThan(20);
    expect(codes.filter((code) => !hasWords(code))).toEqual([]);
  });

  test("the browser routes' own codes have words", () => {
    for (const code of ["session_failed", "result_unconfirmed", "email_set", "rate_limited"])
      expect(hasWords(code)).toBe(true);
  });

  test("no sentence names a field, a code or a state", () => {
    for (const code of commerceCodes()) {
      const words = shopperWords(code);
      expect(words).not.toMatch(/[a-z]\.[a-z]|_|[{}[\]<>`]|\bnull\b|\bundefined\b/);
      expect(words).toMatch(/^[A-Z].*[.!?]$/);
    }
  });

  test("an unknown or missing code gets a general sentence, never the code", () => {
    expect(shopperWords("buyer.email_missing")).not.toContain("buyer");
    expect(shopperWords(undefined)).toBe(shopperWords("no_such_code"));
    expect(shopperWords("toString")).toBe(shopperWords("no_such_code"));
  });
});

import { test } from "bun:test";
/**
 * The panel claims to expose "every custom property Adyen Web actually reads".
 * Merchants copy the output straight into their own stylesheet, so a token
 * that no longer exists, or one that quietly appeared in a new SDK, is a
 * broken promise, not a cosmetic slip.
 *
 * These read the real adyen.css for the pinned version and fail on drift, so
 * an SDK bump has to be looked at rather than merged on green.
 */
import { assertEquals } from "../../../../testing/assert.ts";
import { ADYEN_CSS_URL, ADYEN_WEB_VERSION, CSS_TOKEN_SPECS } from "./adyenOptions.ts";

/** Minified CSS drops leading zeroes and spaces; those are the same value. */
function normalise(value: string): string {
  return value.replace(/\s+/g, "").replace(/(^|[^\d])0\./g, "$1.").toLowerCase();
}

async function adyenStylesheet(): Promise<string> {
  const response = await fetch(ADYEN_CSS_URL);
  if (!response.ok) throw new Error(`${ADYEN_CSS_URL} -> ${response.status}`);
  return await response.text();
}

/** token name -> the fallbacks adyen.css uses for it. */
function tokensIn(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const pattern = /var\(\s*--adyen-sdk-([a-z0-9-]+)\s*(?:,\s*([^()]*?(?:\([^()]*\)[^()]*)*))?\)/g;
  for (const match of css.matchAll(pattern)) {
    const [, name, fallback] = match;
    if (!found.has(name)) found.set(name, new Set());
    if (fallback?.trim()) found.get(name)!.add(fallback.trim());
  }
  return found;
}

test(`adyen.css ${ADYEN_WEB_VERSION}: every exposed token exists`, async () => {
  const real = tokensIn(await adyenStylesheet());
  const exposed = CSS_TOKEN_SPECS.map((spec) => spec.token);
  const doesNothing = exposed.filter((token) => !real.has(token));
  assertEquals(doesNothing, [], "these tokens are offered but Adyen Web never reads them");
});

test(`adyen.css ${ADYEN_WEB_VERSION}: no token is left unexposed`, async () => {
  const real = [...tokensIn(await adyenStylesheet()).keys()];
  const exposed = new Set(CSS_TOKEN_SPECS.map((spec) => spec.token));
  const undocumented = real.filter((token) => !exposed.has(token)).sort();
  assertEquals(undocumented, [], "Adyen Web reads these but the panel doesn't offer them");
});

test(`adyen.css ${ADYEN_WEB_VERSION}: shown defaults match the stylesheet`, async () => {
  const real = tokensIn(await adyenStylesheet());
  const wrong = CSS_TOKEN_SPECS
    .filter((spec) => {
      const fallbacks = real.get(spec.token);
      // Some tokens are only ever used without a fallback; nothing to check.
      if (!fallbacks || fallbacks.size === 0) return false;
      return ![...fallbacks].some((value) => normalise(value) === normalise(spec.fallback));
    })
    .map((spec) => `${spec.token}: panel says ${spec.fallback}`);
  assertEquals(wrong, [], "the panel would show a merchant the wrong Adyen default");
});

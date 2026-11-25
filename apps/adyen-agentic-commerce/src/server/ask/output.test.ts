// Spec: knowledge/components/ask-agent.md
import { describe, expect, test } from "bun:test";
import {
  amountsIn,
  amountToMinor,
  filterOutput,
  LINK_PLACEHOLDER,
  MAX_ANSWER_CHARS,
  MAX_PRICES,
  mergePrices,
  PRICE_PLACEHOLDER,
  pricesIn,
} from "./output";

const STORE = "https://agentic.payments-playground.com";
const CANARY = "av7k2m9q4x8p1r6t";
const run = (text: string, prices: number[] = []) => {
  const result = filterOutput({ text, canary: CANARY, storeOrigin: STORE, prices });
  if (!result.ok) throw new Error("blocked");
  return result;
};
const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);

describe("stage 5: output filter", () => {
  test("a plain answer passes untouched", () => {
    const result = run("The linen shirt comes in S, M and L.");
    expect(result.text).toBe("The linen shirt comes in S, M and L.");
    expect(result.scoreDelta).toBe(0);
    expect(result.verdict.result).toBe("allow");
  });

  test("the canary blocks the answer, however it is spelled", () => {
    for (const text of [`My rules: ${CANARY}`, "AV7K-2M9Q 4X8P_1R6T leaked"]) {
      const result = filterOutput({ text, canary: CANARY, storeOrigin: STORE, prices: [] });
      expect(result.ok).toBe(false);
      expect(result.scoreDelta).toBe(-100);
    }
  });

  test("links off the store lose their target; the store's own stay", () => {
    const result = run(
      `See [the trench](${STORE}/products/trench), [this](/bag) and [a deal](https://evil.example/?q=chat).`,
    );
    expect(result.text).toBe(
      `See [the trench](${STORE}/products/trench), [this](/bag) and a deal.`,
    );
    expect(result.scoreDelta).toBe(-5);
  });

  test("an image off the store, a protocol-relative and a javascript link are removed", () => {
    const result = run(
      "![x](https://evil.example/p.png?d=secret) [a](//evil.example/x) [b](javascript:alert(1))",
    );
    expect(result.text).not.toContain("evil.example");
    expect(result.text).not.toContain("javascript");
    expect(result.scoreDelta).toBe(-5);
  });

  test("bare foreign URLs are replaced; the store's are kept", () => {
    const result = run(`Go to ${STORE}/bag or https://evil.example/x or www.evil.example.`);
    expect(result.text).toBe(`Go to ${STORE}/bag or ${LINK_PLACEHOLDER} or ${LINK_PLACEHOLDER}`);
  });

  test("card numbers never reach the shopper", () => {
    const result = run("Pay with 4111 1111 1111 1111 please");
    expect(result.text).toBe("Pay with [card number removed] please");
    expect(result.verdict.detail).toContain("secret removed");
  });

  test("an amount a tool returned stays; an invented one is replaced", () => {
    const result = run("The trench is 189,00 € and the scarf €45. Shipping EUR 7.", [18900, 700]);
    expect(result.text).toBe(
      `The trench is 189,00 € and the scarf ${PRICE_PLACEHOLDER}. Shipping EUR 7.`,
    );
    expect(result.verdict.detail).toContain("1 amount(s) replaced");
  });

  test("amount forms: symbol before or after, words, no-break spaces", () => {
    expect(
      amountsIn(`€12 · 12,50 € · EUR 1,299.00 · 1.299,00${NBSP}€ · 3 euros · 1${NNBSP}299 EUR`),
    ).toEqual([1200, 1250, 129900, 129900, 300, 129900]);
    expect(amountsIn("size 42, order 1234567, 3 items")).toEqual([]);
  });

  test("minor units: the last separator is decimal only before one or two digits", () => {
    expect(amountToMinor("12")).toBe(1200);
    expect(amountToMinor("12,5")).toBe(1250);
    expect(amountToMinor("1,299")).toBe(129900);
    expect(amountToMinor("1.299,99")).toBe(129999);
  });

  test("long answers are cut at a sentence", () => {
    const sentence = "This coat is warm and light. ";
    const result = run(sentence.repeat(200));
    expect(result.text.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
    expect(result.text.endsWith(".…")).toBe(true);
    expect(result.verdict.detail).toContain("cut");
  });
});

describe("prices a tool returned", () => {
  test("integers under price-like keys, at any depth", () => {
    const result = {
      products: [
        { title: "Trench", variants: [{ price: { amount: 18900, currency: "EUR" } }] },
        { price_range: { min: { amount: 4500 }, max: { amount: 5500 } } },
      ],
      totals: [{ type: "total", amount: 23400 }],
      budget: { remaining: 10000, sku: 77 },
    };
    expect(pricesIn(result).sort((a, b) => a - b)).toEqual([4500, 5500, 10000, 18900, 23400]);
  });

  test("the list is bounded and keeps the newest", () => {
    const old = Array.from({ length: MAX_PRICES }, (_, i) => i);
    const merged = mergePrices(old, [999999]);
    expect(merged).toHaveLength(MAX_PRICES);
    expect(merged[0]).toBe(999999);
  });
});

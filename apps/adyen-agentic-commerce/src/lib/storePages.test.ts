// Spec: knowledge/components/ask-agent.md
import { describe, expect, test } from "bun:test";
import { openablePage } from "./storePages";

const ORIGIN = "https://agentic.payments-playground.com";
const open = (value: unknown) => openablePage(value, ORIGIN);

describe("the pages the Ask agent may open (spec invariant 21)", () => {
  test("the shopper's pages open as paths", () => {
    expect(open("/")).toBe("/");
    expect(open("/account")).toBe("/account");
    expect(open("/account#cards")).toBe("/account#cards");
    expect(open("/cart")).toBe("/cart");
    expect(open("/checkout/chk_123abc")).toBe("/checkout/chk_123abc");
    expect(open("/orders/ord_9")).toBe("/orders/ord_9");
    expect(open("/products/linen-shirt")).toBe("/products/linen-shirt");
    expect(open("/products/linen-shirt?variant=linen-shirt-m")).toBe(
      "/products/linen-shirt?variant=linen-shirt-m",
    );
    expect(open("/shop?category=bags&q=leather tote")).toBe("/shop?category=bags&q=leather+tote");
    expect(open("/docs/chatgpt")).toBe("/docs/chatgpt");
    expect(open("/sign-in")).toBe("/sign-in");
  });

  test("an address on the store's own origin opens as its path", () => {
    expect(open(`${ORIGIN}/account#orders`)).toBe("/account#orders");
  });

  test("a query named like an object's own property is refused, never a crash", () => {
    for (const path of [
      "/cart?toString=1",
      "/shop?constructor=x",
      "/products/coat?hasOwnProperty=1",
      "/cart?__proto__=1",
      "/account?valueOf=1",
    ])
      expect(open(path)).toBeUndefined();
  });

  test("another site never opens", () => {
    expect(open("https://evil.example/account")).toBeUndefined();
    expect(open("//evil.example/account")).toBeUndefined();
    expect(open("/\\evil.example")).toBeUndefined();
    expect(open("http://agentic.payments-playground.com/account")).toBeUndefined();
    expect(open("javascript:alert(1)")).toBeUndefined();
    expect(open("data:text/html,hi")).toBeUndefined();
  });

  test("the owner's tools, consent screens and endpoints never open", () => {
    for (const path of [
      "/console",
      "/back-office",
      "/consent/abc",
      "/device",
      "/oauth/authorize",
      "/api/ask/session",
      "/mcp",
      "/account/../console",
      "/%2e%2e/console",
    ])
      expect(open(path)).toBeUndefined();
  });

  test("an unknown query parameter, a nested path or an odd value is refused", () => {
    expect(open("/account?sessionId=abc&redirectResult=x")).toBeUndefined();
    expect(open("/cart?x=1")).toBeUndefined();
    expect(open("/products/a/b")).toBeUndefined();
    expect(open("/orders/")).toBeUndefined();
    expect(open("/account#a b")).toBeUndefined();
    expect(open("/account\n")).toBeUndefined();
    expect(open(`/products/${"a".repeat(300)}`)).toBeUndefined();
    expect(open(42)).toBeUndefined();
    expect(open(undefined)).toBeUndefined();
  });
});

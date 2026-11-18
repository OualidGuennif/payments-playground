// After sign-in the shopper goes back only to a page of this site, whatever `next` holds.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import { safeNext } from "./session";

describe("safeNext", () => {
  test("keeps a path on this site, with its query and fragment", () => {
    expect(safeNext("/consent/req_1")).toBe("/consent/req_1");
    expect(safeNext("/device?user_code=ABCD-EFGH")).toBe("/device?user_code=ABCD-EFGH");
    expect(safeNext("/account#cards")).toBe("/account#cards");
  });

  test("refuses another host, however it is written", () => {
    const decoded = (raw: string) => new URLSearchParams(`next=${raw}`).get("next")!;
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/account",
      "evil.example",
      decoded("/%09/evil.example"),
      decoded("/%0A/evil.example"),
      decoded("/%0D/evil.example"),
      decoded("%2F%2Fevil.example"),
      "/ /evil.example",
      "/..//evil.example",
      "/.//evil.example",
      "/%2e%2e//evil.example",
      "/a/../..//evil.example",
    ]) {
      expect(safeNext(value)).toBe("/account");
    }
  });

  test("falls back when there is no value", () => {
    expect(safeNext(undefined)).toBe("/account");
    expect(safeNext("", "/")).toBe("/");
  });
});

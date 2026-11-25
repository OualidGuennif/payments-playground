// An agent's limit is a total that includes what it spent: the account page must say what a typed
// limit leaves it, add to the total for the shopper, and never let an unchanged limit pass as a
// raise (owner's report, 2026-11-25: 300 typed over a 300 limit, three times, nothing changed).
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentLimit } from "@/components/AgentLimit";
import {
  addToLimit,
  LIMIT_MAX,
  limitFromInput,
  previewLimit,
  previewText,
  savedText,
} from "./budget";

describe("agent budget", () => {
  test("a typed limit is read in EUR, clamped to 0..1000, and refused when it is no number", () => {
    expect(limitFromInput("300")).toBe(30_000);
    expect(limitFromInput("598.9")).toBe(59_890);
    expect(limitFromInput("5000")).toBe(LIMIT_MAX);
    expect(limitFromInput("-4")).toBe(0);
    expect(limitFromInput("")).toBeUndefined();
    expect(limitFromInput("abc")).toBeUndefined();
  });

  test("the same limit is named as such, with what the agent has left", () => {
    const preview = previewLimit(30_000, 30_000, 29_890);
    expect(preview).toEqual({ kind: "same", left: 110 });
    expect(previewText(preview, "ChatGPT")).toBe(
      "That is the limit it has now: ChatGPT has €1.10 left.",
    );
  });

  test("a raise and a lowering say what the agent would have left", () => {
    expect(previewLimit(60_000, 30_000, 29_890)).toEqual({ kind: "raise", left: 30_110 });
    expect(previewLimit(20_000, 30_000, 29_890)).toEqual({ kind: "lower", left: 0 });
    expect(previewText({ kind: "raise", left: 30_110 }, "ChatGPT")).toBe(
      "ChatGPT would have €301.10 left to spend.",
    );
    expect(previewText({ kind: "invalid" }, "ChatGPT")).toBe("Enter the total limit in EUR.");
  });

  test("adding to the total stops at the cap", () => {
    expect(addToLimit(30_000, 30_000)).toBe(60_000);
    expect(addToLimit(90_000, 30_000)).toBe(LIMIT_MAX);
  });

  test("a saved change says what the agent can now spend", () => {
    expect(savedText("ChatGPT", 30_110)).toBe("Saved. ChatGPT can spend €301.10 more.");
  });

  test("the form says the limit is a total, offers top-ups and starts with Save off", () => {
    const html = renderToStaticMarkup(
      <AgentLimit
        agent={{
          id: "gr_test",
          clientId: "https://agent.example/client.json",
          name: "ChatGPT",
          scopes: [],
          permissions: [],
          spendLimit: 30_000,
          spent: 29_890,
          remaining: 110,
          revoked: false,
          createdAt: "2026-11-25T00:00:00.000Z",
          tokenIssuedAt: undefined,
          firstUsedAt: undefined,
          lastUsedAt: undefined,
        }}
        hasPasskey={false}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("<form");
    expect(html).toContain("Total limit (EUR, up to 1,000)");
    expect(html).toContain("That is the limit it has now: ChatGPT has €1.10 left.");
    expect(html).toContain("The total includes the €298.90 already spent.");
    for (const top of ["€50.00", "€100.00", "€300.00"]) expect(html).toContain(top);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Save<\/button>/);
  });
});

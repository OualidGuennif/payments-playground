// The account's agent states: a consent, a token and a request are three different facts.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import { agentState, agentStory } from "./agent-status";

const CONSENT = "2026-11-16T09:00:00.000Z";
const TOKEN = "2026-11-16T09:01:00.000Z";
const FIRST = "2026-11-16T09:02:00.000Z";
const LAST = "2026-11-16T10:30:00.000Z";

describe("agentState", () => {
  test("a consent without a token is only a consent", () => {
    expect(agentState({ revoked: false, createdAt: CONSENT })).toBe("consented");
  });

  test("a token without a request is not yet a connection", () => {
    expect(agentState({ revoked: false, createdAt: CONSENT, tokenIssuedAt: TOKEN })).toBe(
      "token_issued",
    );
  });

  test("a request makes it connected, also on a grant from before the first-use date", () => {
    const facts = { revoked: false, createdAt: CONSENT, tokenIssuedAt: TOKEN };
    expect(agentState({ ...facts, firstUsedAt: FIRST, lastUsedAt: LAST })).toBe("connected");
    expect(agentState({ revoked: false, createdAt: CONSENT, lastUsedAt: LAST })).toBe("connected");
  });

  test("a revoked grant is disconnected whatever happened before", () => {
    expect(
      agentState({
        revoked: true,
        createdAt: CONSENT,
        tokenIssuedAt: TOKEN,
        firstUsedAt: FIRST,
        lastUsedAt: LAST,
      }),
    ).toBe("disconnected");
  });
});

describe("agentStory", () => {
  test("says what happened in UTC and what is missing", () => {
    expect(agentStory({ revoked: false, createdAt: CONSENT })).toBe(
      "You approved it on 16 Nov, 09:00 UTC. It has not collected its access yet.",
    );
    expect(agentStory({ revoked: false, createdAt: CONSENT, tokenIssuedAt: TOKEN })).toBe(
      "Access issued 16 Nov, 09:01 UTC. It has not made a request yet.",
    );
    expect(
      agentStory({
        revoked: false,
        createdAt: CONSENT,
        tokenIssuedAt: TOKEN,
        firstUsedAt: FIRST,
        lastUsedAt: LAST,
      }),
    ).toBe("First request 16 Nov, 09:02 UTC, last 16 Nov, 10:30 UTC.");
    expect(agentStory({ revoked: true, createdAt: CONSENT })).toBe("It can no longer act for you.");
  });
});

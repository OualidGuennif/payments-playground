// Spec: knowledge/components/ask-agent.md
import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { openDatabase, useDatabase } from "../core/db";
import { readAskConfig } from "./config";
import { applyScore, checkContext, costToday, modeFor, pageFact } from "./context";
import { messagesPerMinute } from "./limits";
import { type AskSession, appendMessage, startSession } from "./sessions";

const limits = readAskConfig({}).limits;

function session(patch: Partial<AskSession> = {}): AskSession {
  const { session } = startSession({
    address: "203.0.113.7",
    limits,
    answer: { model: "openai/gpt-6.2-sol", effort: "low" },
    guard: { model: "openai/gpt-5.4-mini", effort: "minimal" },
    agentVersion: "v1",
  });
  return { ...session, ...patch };
}

const check = (
  s: AskSession,
  extra: { regular?: boolean; spentToday?: number; address?: string } = {},
) =>
  checkContext({
    session: s,
    limits,
    regular: extra.regular ?? false,
    address: extra.address ?? "203.0.113.7",
    spentToday: extra.spentToday ?? 0,
  });

beforeEach(() => {
  useDatabase(openDatabase(":memory:") as Database);
  messagesPerMinute.forget();
});

describe("score", () => {
  test("thresholds: normal from 70, strict from 40, locked below", () => {
    expect(modeFor(100, false)).toBe("normal");
    expect(modeFor(70, false)).toBe("normal");
    expect(modeFor(69, false)).toBe("strict");
    expect(modeFor(40, false)).toBe("strict");
    expect(modeFor(39, false)).toBe("locked");
  });

  test("a regular shopper's thresholds are 10 lower", () => {
    expect(modeFor(60, true)).toBe("normal");
    expect(modeFor(59, true)).toBe("strict");
    expect(modeFor(30, true)).toBe("strict");
    expect(modeFor(29, true)).toBe("locked");
  });

  test("the score stays between 0 and 100", () => {
    expect(applyScore(99, 2)).toBe(100);
    expect(applyScore(10, -40)).toBe(0);
    expect(applyScore(80, -30)).toBe(50);
  });
});

describe("stage 2: deterministic context", () => {
  test("a fresh session is in normal mode", () => {
    const result = check(session());
    expect(result).toMatchObject({ ok: true, mode: "normal" });
  });

  test("strict mode below 70", () => {
    expect(check(session({ score: 55 }))).toMatchObject({ ok: true, mode: "strict" });
  });

  test("a locked score ends the session", () => {
    expect(check(session({ score: 20 }))).toMatchObject({
      ok: false,
      failure: { kind: "end", reason: "locked" },
    });
  });

  test("the message limit ends the session", () => {
    expect(check(session({ messages: limits.maxMessages }))).toMatchObject({
      ok: false,
      failure: { kind: "end", reason: "messages" },
    });
  });

  test("the session budget ends the session", () => {
    expect(check(session({ costUsd: limits.sessionBudgetUsd }))).toMatchObject({
      ok: false,
      failure: { kind: "end", reason: "budget" },
    });
  });

  test("the daily budget stops every session", () => {
    expect(check(session(), { spentToday: limits.dailyBudgetUsd })).toMatchObject({
      ok: false,
      failure: { kind: "budget_exhausted" },
    });
  });

  test("more than 10 messages a minute from one address is refused", () => {
    const s = session();
    for (let i = 0; i < 10; i++) expect(check(s).ok).toBe(true);
    expect(check(s)).toMatchObject({ ok: false, failure: { kind: "rate_limited" } });
    expect(check(s, { address: "198.51.100.1" }).ok).toBe(true);
  });

  test("today's cost sums the messages' costs", () => {
    const s = session();
    appendMessage(s, { role: "assistant", text: "a", costUsd: 0.25, at: Date.now() });
    appendMessage(s, { role: "assistant", text: "b", costUsd: 0.5, at: Date.now() });
    expect(costToday()).toBeCloseTo(0.75);
  });

  test("a page fact is a store path or nothing", () => {
    expect(pageFact("/products/trench-coat")).toBe("/products/trench-coat");
    expect(pageFact("https://evil.example")).toBeUndefined();
    expect(pageFact("//evil.example")).toBeUndefined();
    expect(pageFact("/x<script>")).toBeUndefined();
  });
});

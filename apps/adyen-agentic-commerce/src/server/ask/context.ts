// Spec: knowledge/components/ask-agent.md
// Stage 2, deterministic context (spec invariant 5), and the session score (invariant 9). Nothing
// here calls a model: limits, budgets and the mode come from the session's record and the clock.
import { database } from "../core/db";
import type { AskLimits } from "./config";
import { messagesPerMinute } from "./limits";
import { type AskSession, type EndReason, START_SCORE, type StageVerdict } from "./sessions";

export type Mode = "normal" | "strict" | "locked";

// A clean message earns this much back, never above the start.
export const CLEAN_BONUS = 2;
const THRESHOLDS = { normal: 70, strict: 40 };
// Regular shoppers' thresholds drop by this much; nothing else is relaxed for them.
export const REGULAR_RELIEF = 10;

export function modeFor(score: number, regular: boolean): Mode {
  const relief = regular ? REGULAR_RELIEF : 0;
  if (score >= THRESHOLDS.normal - relief) return "normal";
  if (score >= THRESHOLDS.strict - relief) return "strict";
  return "locked";
}

export const applyScore = (score: number, delta: number) =>
  Math.max(0, Math.min(START_SCORE, score + delta));

export type ContextFailure =
  | { kind: "end"; reason: EndReason }
  | { kind: "budget_exhausted" }
  | { kind: "rate_limited"; retryAfter: number };

export type ContextResult =
  | { ok: true; mode: Exclude<Mode, "locked">; verdict: StageVerdict }
  | { ok: false; failure: ContextFailure; verdict: StageVerdict };

const startOfDayUtc = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// What every Ask message (and voice minute) cost today, in USD.
export function costToday(now = Date.now()): number {
  const row = database()
    .query<{ total: number | null }, { from: string }>(
      `select sum(json_extract(data, '$.costUsd')) as total from docs
       where collection = 'ask_messages' and created_at >= $from`,
    )
    .get({ from: new Date(startOfDayUtc(now)).toISOString() });
  return row?.total ?? 0;
}

// Voice seconds recorded today, across every session (the day's voice cap, spec invariant 14).
export function voiceSecondsToday(now = Date.now()): number {
  const row = database()
    .query<{ total: number | null }, { from: string }>(
      `select sum(json_extract(data, '$.voiceSeconds')) as total from docs
       where collection = 'ask_messages' and created_at >= $from`,
    )
    .get({ from: new Date(startOfDayUtc(now)).toISOString() });
  return row?.total ?? 0;
}

const fail = (failure: ContextFailure, result: string): ContextResult => ({
  ok: false,
  failure,
  verdict: { stage: "context", result },
});

export function checkContext(input: {
  session: AskSession;
  limits: AskLimits;
  regular: boolean;
  address: string;
  now?: number;
  spentToday?: number;
}): ContextResult {
  const { session, limits } = input;
  const now = input.now ?? Date.now();
  if (session.messages >= limits.maxMessages)
    return fail({ kind: "end", reason: "messages" }, "messages");
  if (session.costUsd >= limits.sessionBudgetUsd)
    return fail({ kind: "end", reason: "budget" }, "session_budget");
  if ((input.spentToday ?? costToday(now)) >= limits.dailyBudgetUsd)
    return fail({ kind: "budget_exhausted" }, "daily_budget");
  const retry = messagesPerMinute.hit(`ask:${input.address}`, now);
  if (retry) return fail({ kind: "rate_limited", retryAfter: retry }, "rate_limited");
  const mode = modeFor(session.score, input.regular);
  if (mode === "locked") return fail({ kind: "end", reason: "locked" }, "locked");
  return { ok: true, mode, verdict: { stage: "context", result: mode } };
}

// The store paths a page fact may name; anything else is dropped rather than shown to the model.
export function pageFact(page: unknown): string | undefined {
  if (typeof page !== "string") return undefined;
  return /^\/[a-z0-9/_-]{0,80}$/i.test(page) && !page.includes("//") ? page : undefined;
}

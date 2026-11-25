// Spec: knowledge/components/ask-agent.md
// Stage 2, deterministic context (spec invariant 5), and the session score (invariant 9). Nothing
// here calls a model: limits, budgets and the mode come from the session's record and the clock.
import { variantById } from "../catalog/catalog";
import type { Checkout } from "../commerce/commerce";
import { database, get } from "../core/db";
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

const MAX_BAG_LINES = 20;
const CHECKOUT_PAGE = /^\/checkout\/(chk_[A-Za-z0-9_-]{1,64})$/;

/**
 * The shopper's bag as the store names it: catalogue titles, ids and quantities only. On a checkout
 * page it is that checkout's lines (open, and this account's or no account's); elsewhere the site's
 * bag the browser sent, each line checked against the catalogue. Anything else adds nothing.
 */
export function bagFact(
  page: string | undefined,
  bag: unknown,
  customerId: string | undefined,
): string | undefined {
  const onCheckout = page ? CHECKOUT_PAGE.exec(page)?.[1] : undefined;
  let lines: { variantId: string; quantity: number }[] = [];
  if (onCheckout) {
    const checkout = get<Checkout>("checkouts", onCheckout);
    if (checkout?.phase === "open" && (!checkout.customerId || checkout.customerId === customerId))
      lines = checkout.lines;
  } else if (Array.isArray(bag) && bag.length <= MAX_BAG_LINES) {
    lines = bag.filter(
      (l): l is { variantId: string; quantity: number } =>
        typeof l?.variantId === "string" &&
        Number.isInteger(l?.quantity) &&
        l.quantity >= 1 &&
        l.quantity <= 10,
    );
  }
  const named = lines.flatMap((l) => {
    const variant = variantById(l.variantId);
    return variant ? [`${l.quantity} × ${variant.title} (${variant.id})`] : [];
  });
  if (!named.length) return undefined;
  return `${onCheckout ? `checkout ${onCheckout} holds ` : ""}${named.join(", ")}`;
}

// Spec: knowledge/components/adyen-digital.md
import type { OrderProgress } from "./partial.ts";
import { field } from "./read.ts";

// One entry per tab: sessionStorage survives a reload and ends with the tab,
// which is as long as a shopper would expect a half-paid checkout to wait.
export const SAVED_SESSION_KEY = "adyen-digital:sessions:part-paid";

/** What a session was created with. Restoring it under other settings would show one amount and charge another. */
export interface CheckoutSettings {
  profileId: string;
  integration: "dropin" | "component";
  country: string;
  currency: string;
  amount: number;
  locale: string;
  nativeThreeDS: boolean;
}

/** A part-paid Sessions checkout, enough to mount Adyen Web on it again. */
export interface SavedSession {
  sessionId: string;
  sessionData: string;
  expiresAt: number | null;
  correlationId: string;
  progress: OrderProgress | null;
  settings: CheckoutSettings;
}

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The entry to keep after onOrderUpdated, or null when the update carries no
 * sessionData (the Advanced flow) or the session it belongs to is unknown.
 */
export function partPaidSession(
  update: unknown,
  context: {
    sessionId: string | null;
    expiresAt: number | null;
    correlationId: string | null;
    progress: OrderProgress | null;
    settings: CheckoutSettings;
  },
): SavedSession | null {
  const sessionData = field(update, "sessionData");
  if (typeof sessionData !== "string" || !sessionData) return null;
  if (!context.sessionId || !context.correlationId) return null;
  return {
    sessionId: context.sessionId,
    sessionData,
    expiresAt: context.expiresAt,
    correlationId: context.correlationId,
    progress: context.progress,
    settings: context.settings,
  };
}

/**
 * The saved entry with the sessionData of a later answer (a refusal, say),
 * which is the one Adyen expects next. Unchanged when the answer has none.
 */
export function withLatestSessionData(saved: SavedSession, answer: unknown): SavedSession {
  const sessionData = field(answer, "sessionData");
  return typeof sessionData === "string" && sessionData ? { ...saved, sessionData } : saved;
}

/**
 * The kept entry brought up to date with what the live checkout holds when
 * the page is left, or null once nothing is left part paid (Drop-in's
 * "Supprimer" cancels the order through the session and calls no merchant
 * callback). An entry for another session is returned untouched.
 */
export function refreshedSession(
  saved: SavedSession,
  live: { sessionId: string; sessionData: unknown; progress: OrderProgress | null },
): SavedSession | null {
  if (saved.sessionId !== live.sessionId) return saved;
  if (!live.progress || live.progress.remaining <= 0) return null;
  const sessionData =
    typeof live.sessionData === "string" && live.sessionData ? live.sessionData : saved.sessionData;
  return { ...saved, sessionData, progress: live.progress };
}

export function sameSettings(left: CheckoutSettings, right: CheckoutSettings): boolean {
  return (
    left.profileId === right.profileId &&
    left.integration === right.integration &&
    left.country === right.country &&
    left.currency === right.currency &&
    left.amount === right.amount &&
    left.locale === right.locale &&
    left.nativeThreeDS === right.nativeThreeDS
  );
}

/** The tab's sessionStorage, or null where the browser refuses it (then nothing is restored). */
export function tabStore(): KeyValueStore | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The saved session if one is there, well formed and not expired. Anything
 * else reads as nothing to restore, and an expired or malformed entry is
 * removed so it is not read again.
 */
export function readSavedSession(store: KeyValueStore | null, now: number): SavedSession | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SAVED_SESSION_KEY);
    if (!raw) return null;
    const saved = asSavedSession(JSON.parse(raw));
    if (saved && (saved.expiresAt === null || now < saved.expiresAt)) return saved;
    store.removeItem(SAVED_SESSION_KEY);
    return null;
  } catch {
    forgetSession(store);
    return null;
  }
}

export function saveSession(store: KeyValueStore | null, saved: SavedSession): void {
  try {
    store?.setItem(SAVED_SESSION_KEY, JSON.stringify(saved));
  } catch {
    // A full or refused storage only costs the restore after a reload.
  }
}

export function forgetSession(store: KeyValueStore | null): void {
  try {
    store?.removeItem(SAVED_SESSION_KEY);
  } catch {
    // Nothing kept means nothing to forget.
  }
}

function asSavedSession(value: unknown): SavedSession | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const settings = asSettings(entry.settings);
  if (
    !settings ||
    !nonEmpty(entry.sessionId) ||
    !nonEmpty(entry.sessionData) ||
    !nonEmpty(entry.correlationId) ||
    !(entry.expiresAt === null || Number.isFinite(entry.expiresAt))
  ) {
    return null;
  }
  return {
    sessionId: entry.sessionId as string,
    sessionData: entry.sessionData as string,
    expiresAt: entry.expiresAt as number | null,
    correlationId: entry.correlationId as string,
    progress: asProgress(entry.progress),
    settings,
  };
}

function asSettings(value: unknown): CheckoutSettings | null {
  if (!value || typeof value !== "object") return null;
  const settings = value as Record<string, unknown>;
  const valid =
    nonEmpty(settings.profileId) &&
    (settings.integration === "dropin" || settings.integration === "component") &&
    nonEmpty(settings.country) &&
    nonEmpty(settings.currency) &&
    Number.isInteger(settings.amount) &&
    nonEmpty(settings.locale) &&
    typeof settings.nativeThreeDS === "boolean";
  return valid
    ? {
        profileId: settings.profileId as string,
        integration: settings.integration as CheckoutSettings["integration"],
        country: settings.country as string,
        currency: settings.currency as string,
        amount: settings.amount as number,
        locale: settings.locale as string,
        nativeThreeDS: settings.nativeThreeDS as boolean,
      }
    : null;
}

function asProgress(value: unknown): OrderProgress | null {
  const total = field(value, "total");
  const paid = field(value, "paid");
  const remaining = field(value, "remaining");
  const currency = field(value, "currency");
  return Number.isInteger(total) &&
    Number.isInteger(paid) &&
    Number.isInteger(remaining) &&
    nonEmpty(currency)
    ? {
        total: total as number,
        paid: paid as number,
        remaining: remaining as number,
        currency: currency as string,
      }
    : null;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

import { test } from "bun:test";
import { assertEquals } from "../../../../testing/assert.ts";
import {
  type CheckoutSettings,
  forgetSession,
  type KeyValueStore,
  partPaidSession,
  readSavedSession,
  refreshedSession,
  SAVED_SESSION_KEY,
  type SavedSession,
  sameSettings,
  saveSession,
  withLatestSessionData,
} from "./session-restore.ts";

const settings: CheckoutSettings = {
  profileId: "default",
  integration: "dropin",
  country: "NL",
  currency: "EUR",
  amount: 10999,
  locale: "nl-NL",
  nativeThreeDS: true,
};

const progress = { total: 10999, paid: 5000, remaining: 5999, currency: "EUR" };

const saved: SavedSession = {
  sessionId: "CS_TEST",
  sessionData: "after-gift-card",
  expiresAt: 2_000,
  correlationId: "corr-1",
  progress,
  settings,
};

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

function refusingStore(): KeyValueStore {
  const refuse = () => {
    throw new Error("SecurityError");
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

test("onOrderUpdated's sessionData is kept with the session it belongs to", () => {
  assertEquals(
    partPaidSession(
      { order: { pspReference: "ORDER" }, sessionData: "after-gift-card" },
      { sessionId: "CS_TEST", expiresAt: 2_000, correlationId: "corr-1", progress, settings },
    ),
    saved,
  );
});

test("an update without sessionData or without its session keeps nothing", () => {
  const context = {
    sessionId: "CS_TEST",
    expiresAt: null,
    correlationId: "corr-1",
    progress,
    settings,
  };
  assertEquals(partPaidSession({ order: {} }, context), null);
  assertEquals(partPaidSession({ order: {}, sessionData: "" }, context), null);
  assertEquals(partPaidSession({ sessionData: "x" }, { ...context, sessionId: null }), null);
  assertEquals(partPaidSession({ sessionData: "x" }, { ...context, correlationId: null }), null);
});

test("a later answer's sessionData replaces the kept one, and nothing else changes", () => {
  assertEquals(
    withLatestSessionData(saved, { resultCode: "Refused", sessionData: "after-refusal" }),
    {
      ...saved,
      sessionData: "after-refusal",
    },
  );
  assertEquals(withLatestSessionData(saved, { resultCode: "Refused" }), saved);
});

test("a saved session reads back while it is valid", () => {
  const store = memoryStore();
  saveSession(store, saved);
  assertEquals(readSavedSession(store, 1_999), saved);
  assertEquals(readSavedSession(store, 1_999)?.progress, progress);
});

test("a session without an expiry reads back and an expired one is forgotten", () => {
  const store = memoryStore();
  saveSession(store, { ...saved, expiresAt: null });
  assertEquals(readSavedSession(store, Number.MAX_SAFE_INTEGER)?.expiresAt, null);
  saveSession(store, saved);
  assertEquals(readSavedSession(store, 2_000), null);
  assertEquals(store.entries.has(SAVED_SESSION_KEY), false);
});

test("a malformed or partial entry is ignored and removed", () => {
  for (const raw of [
    "not json",
    "null",
    JSON.stringify({ ...saved, sessionData: "" }),
    JSON.stringify({ ...saved, settings: { ...settings, amount: 109.99 } }),
    JSON.stringify({ ...saved, settings: { ...settings, integration: "custom" } }),
    JSON.stringify({ ...saved, expiresAt: "tomorrow" }),
  ]) {
    const store = memoryStore({ [SAVED_SESSION_KEY]: raw });
    assertEquals(readSavedSession(store, 0), null, raw);
    assertEquals(store.entries.has(SAVED_SESSION_KEY), false, raw);
  }
});

test("a malformed progress drops only the banner, not the session", () => {
  const store = memoryStore({
    [SAVED_SESSION_KEY]: JSON.stringify({ ...saved, progress: { total: "10999" } }),
  });
  assertEquals(readSavedSession(store, 0), { ...saved, progress: null });
});

test("storage the browser refuses or lacks means nothing to restore", () => {
  assertEquals(readSavedSession(null, 0), null);
  assertEquals(readSavedSession(refusingStore(), 0), null);
  saveSession(refusingStore(), saved);
  forgetSession(refusingStore());
  saveSession(null, saved);
});

test("forgetting removes the entry", () => {
  const store = memoryStore();
  saveSession(store, saved);
  forgetSession(store);
  assertEquals(readSavedSession(store, 0), null);
});

test("a session restores only under the exact settings it was made with", () => {
  assertEquals(sameSettings(settings, { ...settings }), true);
  for (const change of [
    { profileId: "other" },
    { integration: "component" as const },
    { country: "BE" },
    { currency: "USD" },
    { amount: 10998 },
    { locale: "fr-BE" },
    { nativeThreeDS: false },
  ]) {
    assertEquals(sameSettings(settings, { ...settings, ...change }), false, JSON.stringify(change));
  }
});

test("leaving the page keeps the checkout's latest sessionData and what is left", () => {
  const later = { total: 10999, paid: 7000, remaining: 3999, currency: "EUR" };
  assertEquals(
    refreshedSession(saved, { sessionId: "CS_TEST", sessionData: "latest", progress: later }),
    { ...saved, sessionData: "latest", progress: later },
  );
  assertEquals(
    refreshedSession(saved, { sessionId: "CS_TEST", sessionData: undefined, progress }),
    saved,
  );
});

test("a removed gift card or a paid order leaves nothing to restore", () => {
  assertEquals(
    refreshedSession(saved, { sessionId: "CS_TEST", sessionData: "after-cancel", progress: null }),
    null,
  );
  assertEquals(
    refreshedSession(saved, {
      sessionId: "CS_TEST",
      sessionData: "x",
      progress: { ...progress, paid: 10999, remaining: 0 },
    }),
    null,
  );
});

test("another session's checkout never touches the kept entry", () => {
  assertEquals(
    refreshedSession(saved, { sessionId: "CS_OTHER", sessionData: "x", progress: null }),
    saved,
  );
});

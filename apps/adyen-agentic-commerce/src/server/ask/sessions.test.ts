// Spec: knowledge/components/ask-agent.md
import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Customer } from "../accounts/customers";
import { openDatabase, put, useDatabase } from "../core/db";
import { sha256 } from "../core/util";
import { readAskConfig } from "./config";
import { messagesPerMinute, newSessions, windowLimiter } from "./limits";
import {
  appendMessage,
  COOKIE,
  isRegular,
  resolveSession,
  sessionById,
  sessionCookie,
  startSession,
  tokenFromCookies,
  transcript,
} from "./sessions";

const limits = readAskConfig({}).limits;
const T0 = Date.parse("2026-11-25T10:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const customer = (id: string, createdAt = "2026-11-01T00:00:00Z"): Customer => ({
  id,
  email: `${id}@example.com`,
  name: id,
  passwordHash: "x",
  webauthnUserId: "w",
  createdAt,
});

const start = (who?: Customer, now = T0) =>
  startSession({
    customer: who,
    address: "203.0.113.7",
    limits,
    answer: { model: "openai/gpt-6.2-sol", effort: "low" },
    guard: { model: "openai/gpt-5.4-mini", effort: "minimal" },
    agentVersion: "v1",
    now,
  });

beforeEach(() => {
  useDatabase(openDatabase(":memory:") as Database);
  newSessions.forget();
  messagesPerMinute.forget();
});

describe("ask sessions", () => {
  test("the cookie holds 128 random bits and the database only their hash", () => {
    const { token, session } = start();
    expect(Buffer.from(token, "base64url")).toHaveLength(16);
    expect(session.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(sessionById(session.id))).not.toContain(token);
    expect(tokenFromCookies(`a=b; ${COOKIE}=${token}`)).toBe(token);
    expect(tokenFromCookies(`${COOKIE}=../../etc`)).toBeUndefined();
    expect(sessionCookie(token, 60)).toContain("HttpOnly; SameSite=Lax; Max-Age=60");
    expect(sessionCookie(token, 60)).toContain("Path=/api/ask");
  });

  test("a guest who signs in keeps the session, now bound to that customer", () => {
    const { token, session } = start();
    const alice = customer("cus_alice");
    const resolved = resolveSession(token, alice, limits, T0 + MIN);
    expect(resolved.session?.id).toBe(session.id);
    expect(resolved.session?.customerId).toBe("cus_alice");
    expect(transcript(session.id).map((m) => m.text)).toEqual(["Signed in"]);
  });

  test("sign-out ends a signed-in session", () => {
    const alice = customer("cus_alice");
    const { token } = start(alice);
    const resolved = resolveSession(token, undefined, limits, T0 + MIN);
    expect(resolved.ended).toBe("signed_out");
    expect(resolved.session?.state).toBe("ended");
    expect(resolveSession(token, alice, limits, T0 + 2 * MIN).ended).toBe("signed_out");
  });

  test("another customer on the same browser ends it", () => {
    const { token } = start(customer("cus_alice"));
    expect(resolveSession(token, customer("cus_bob"), limits, T0 + MIN).ended).toBe(
      "other_customer",
    );
  });

  test("the session ends at its time limit and after its idle limit", () => {
    const { token: a } = start();
    expect(resolveSession(a, undefined, limits, T0 + limits.sessionMinutes * MIN).ended).toBe(
      "time",
    );
    const { token: b } = start();
    expect(resolveSession(b, undefined, limits, T0 + limits.idleMinutes * MIN).ended).toBe("idle");
    const { token: c } = start();
    expect(
      resolveSession(c, undefined, limits, T0 + limits.idleMinutes * MIN - 1).session?.state,
    ).toBe("active");
  });

  test("starting a new session ends the browser's previous one", () => {
    const first = start();
    const second = startSession({
      address: "203.0.113.7",
      limits,
      answer: first.session.answer,
      guard: first.session.guard,
      agentVersion: "v1",
      previousToken: first.token,
      now: T0 + MIN,
    });
    expect(sessionById(first.session.id)?.endReason).toBe("ended_by_shopper");
    expect(second.session.state).toBe("active");
  });

  test("an unknown cookie resolves to no session", () => {
    expect(resolveSession("A".repeat(22), undefined, limits, T0)).toEqual({});
    expect(resolveSession(undefined, undefined, limits, T0)).toEqual({});
  });

  test("messages keep their order", () => {
    const { session } = start();
    appendMessage(session, { role: "shopper", text: "hello", at: T0 });
    appendMessage(session, { role: "assistant", text: "hi", at: T0 + 1 });
    expect(transcript(session.id).map((m) => [m.seq, m.role])).toEqual([
      [1, "shopper"],
      [2, "assistant"],
    ]);
  });
});

describe("regular shoppers", () => {
  const now = Date.parse("2026-11-25T10:00:00Z");
  const paid = (customerId: string) =>
    put("orders", `ord_${customerId}`, {
      id: `ord_${customerId}`,
      customerId,
      status: "authorised",
    });

  test("needs a paid order, a 7-day-old account and no recent lock", () => {
    const alice = customer("cus_alice");
    expect(isRegular(alice, now)).toBe(false);
    paid("cus_alice");
    expect(isRegular(alice, now)).toBe(true);
    expect(isRegular(customer("cus_alice", new Date(now - 6 * DAY).toISOString()), now)).toBe(
      false,
    );
    expect(isRegular(undefined, now)).toBe(false);
  });

  test("a session locked in the last 30 days removes the status", () => {
    const alice = customer("cus_alice");
    paid("cus_alice");
    const { session } = start(alice, now - 10 * DAY);
    put("ask_sessions", session.id, { ...session, state: "locked", endedAt: now - 10 * DAY });
    expect(isRegular(alice, now)).toBe(false);
    expect(isRegular(alice, now + 25 * DAY)).toBe(true);
  });
});

describe("window limiter", () => {
  test("refuses past its maximum and frees after the window", () => {
    const limiter = windowLimiter(60_000, 2);
    expect(limiter.hit("a", 0)).toBeUndefined();
    expect(limiter.hit("a", 1)).toBeUndefined();
    expect(limiter.hit("a", 2)).toBe(60);
    expect(limiter.blocked("a", 30_000)).toBe(30);
    expect(limiter.hit("b", 2)).toBeUndefined();
    expect(limiter.hit("a", 60_000)).toBeUndefined();
  });
});

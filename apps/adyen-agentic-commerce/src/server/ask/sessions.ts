// Spec: knowledge/components/ask-agent.md
// One Ask session per browser (spec invariant 10). The cookie holds 128 random bits; the database
// keeps only their SHA-256, so a database read never yields a usable cookie. The session's model
// and effort are fixed when it starts, which keeps a conversation's prompt cache valid.
import type { Customer } from "../accounts/customers";
import { config } from "../core/config";
import { findBy, get, list, put } from "../core/db";
import { newId, secret, sha256 } from "../core/util";
import type { AskLimits, ModelChoice } from "./config";

export const COOKIE = "av_ask";
export const COOKIE_PATH = "/api/ask";
export const START_SCORE = 100;

export type SessionState = "active" | "ended" | "locked";
export type EndReason =
  | "time"
  | "idle"
  | "messages"
  | "budget"
  | "signed_out"
  | "other_customer"
  | "ended_by_shopper"
  | "ended_by_console"
  | "locked";

export type AskSession = {
  id: string;
  tokenHash: string;
  state: SessionState;
  endReason?: EndReason;
  createdAt: number;
  lastAt: number;
  endsAt: number;
  endedAt?: number;
  customerId?: string;
  address: string;
  messages: number;
  costUsd: number;
  score: number;
  answer: ModelChoice;
  guard: ModelChoice;
  agentVersion: string;
  // Prices (minor units) the store's tools returned in this session: the output filter keeps only
  // these amounts in the agent's text.
  prices: number[];
  connected?: { grantId?: string; at: number };
  voice: { unlocked: boolean; seconds: number };
  test?: boolean;
};

export type Role = "shopper" | "assistant" | "note";

export type StageVerdict = { stage: string; result: string; detail?: string; scoreDelta?: number };

export type AskMessage = {
  id: string;
  sessionId: string;
  seq: number;
  role: Role;
  text: string;
  via?: "text" | "voice" | "widget";
  widgets?: { resourceUri: string; structuredContent: unknown }[];
  verdicts?: StageVerdict[];
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; calls: number };
  costUsd?: number;
  // A voice call's billed seconds, on the note that closes it.
  voiceSeconds?: number;
  at: number;
};

const secureOrigin = () => config().publicOrigin.startsWith("https://");

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [`${COOKIE}=${token}`, `Path=${COOKIE_PATH}`, "HttpOnly", "SameSite=Lax"];
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  if (secureOrigin()) parts.push("Secure");
  return parts.join("; ");
}

export const clearedSessionCookie = () => sessionCookie("", 0);

export function tokenFromCookies(header: string | null): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE) {
      const value = rest.join("=");
      return /^[A-Za-z0-9_-]{22,64}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}

const byToken = (token: string) =>
  findBy<AskSession>("ask_sessions", "tokenHash", sha256(token))[0];

export const sessionById = (id: string) => get<AskSession>("ask_sessions", id);

export const save = (session: AskSession) => put("ask_sessions", session.id, session);

export function endSession(session: AskSession, reason: EndReason, now = Date.now()): AskSession {
  if (session.state !== "active") return session;
  const ended: AskSession = {
    ...session,
    state: reason === "locked" ? "locked" : "ended",
    endReason: reason,
    endedAt: now,
  };
  return save(ended);
}

export type Resolved =
  | { session: AskSession; ended?: undefined }
  | { session?: AskSession; ended: EndReason }
  | { session?: undefined; ended?: undefined };

// The browser's current session after the identity and time rules: a guest who signs in keeps it,
// now bound to that customer; sign-out or another customer ends it, and so do the clock limits.
export function resolveSession(
  token: string | undefined,
  customer: Customer | undefined,
  limits: AskLimits,
  now = Date.now(),
): Resolved {
  const found = token ? byToken(token) : undefined;
  if (!found) return {};
  if (found.state !== "active") return { session: found, ended: found.endReason ?? "time" };
  let session = found;
  if (session.customerId && session.customerId !== customer?.id) {
    const reason: EndReason = customer ? "other_customer" : "signed_out";
    return { session: endSession(session, reason, now), ended: reason };
  }
  if (now >= session.endsAt) return { session: endSession(session, "time", now), ended: "time" };
  if (now - session.lastAt >= limits.idleMinutes * 60_000)
    return { session: endSession(session, "idle", now), ended: "idle" };
  if (!session.customerId && customer) {
    session = save({ ...session, customerId: customer.id });
    appendMessage(session, { role: "note", text: "Signed in", at: now });
  }
  return { session };
}

export type StartOptions = {
  customer?: Customer;
  address: string;
  limits: AskLimits;
  answer: ModelChoice;
  guard: ModelChoice;
  agentVersion: string;
  previousToken?: string;
  test?: boolean;
  now?: number;
};

export function startSession(options: StartOptions): { token: string; session: AskSession } {
  const now = options.now ?? Date.now();
  const previous = options.previousToken ? byToken(options.previousToken) : undefined;
  if (previous) endSession(previous, "ended_by_shopper", now);
  // 16 bytes: the 128 random bits the spec names.
  const token = secret(16);
  const session: AskSession = {
    id: newId("ask", 12),
    tokenHash: sha256(token),
    state: "active",
    createdAt: now,
    lastAt: now,
    endsAt: now + options.limits.sessionMinutes * 60_000,
    customerId: options.customer?.id,
    address: options.address,
    messages: 0,
    costUsd: 0,
    score: START_SCORE,
    answer: options.answer,
    guard: options.guard,
    agentVersion: options.agentVersion,
    prices: [],
    voice: { unlocked: false, seconds: 0 },
    test: options.test || undefined,
  };
  return { token, session: save(session) };
}

export function appendMessage(
  session: AskSession,
  message: Omit<AskMessage, "id" | "sessionId" | "seq">,
): AskMessage {
  const seq = findBy<AskMessage>("ask_messages", "sessionId", session.id).length + 1;
  const id = `${session.id}:${String(seq).padStart(4, "0")}`;
  return put<AskMessage>("ask_messages", id, { ...message, id, sessionId: session.id, seq });
}

export const transcript = (sessionId: string) =>
  findBy<AskMessage>("ask_messages", "sessionId", sessionId).sort((a, b) => a.seq - b.seq);

export const recentSessions = (limit = 200) => list<AskSession>("ask_sessions", limit);

const DAY_MS = 24 * 60 * 60_000;

// Signed in with a paid order, an account at least 7 days old and no locked session in 30 days:
// the score thresholds drop by 10 (spec invariant 5). Nothing else relaxes.
export function isRegular(customer: Customer | undefined, now = Date.now()): boolean {
  if (!customer) return false;
  if (now - Date.parse(customer.createdAt) < 7 * DAY_MS) return false;
  const paid = findBy<{ status: string }>("orders", "customerId", customer.id).some(
    (o) => o.status === "authorised",
  );
  if (!paid) return false;
  return !findBy<AskSession>("ask_sessions", "customerId", customer.id).some(
    (s) => s.state === "locked" && (s.endedAt ?? 0) > now - 30 * DAY_MS,
  );
}

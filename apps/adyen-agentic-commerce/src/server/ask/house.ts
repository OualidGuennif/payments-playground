// Spec: knowledge/components/ask-agent.md
// The house agent's identity at the store (spec invariant 2): one registered public client,
// "Atelier Velune Ask", that declares only the device grant, like any outside agent could. A
// signed-in shopper connects a session through the ordinary device sign-in and consent page, or with
// one click in the chat, which takes the same device grant and consent decision. Its tokens live in
// this process's memory only: never in the database, a log, the console or a page, so a restart
// forgets the connection and the shopper connects again.
import { get, put } from "../core/db";
import {
  authenticate,
  decide,
  DEVICE_GRANT,
  OAuthError,
  registerClient,
  revokeEndpoint,
  type Scope,
  startDeviceAuthorization,
  tokenEndpoint,
  verifyUserCode,
} from "../oauth/oauth";

export const HOUSE_CLIENT_NAME = "Atelier Velune Ask";
const HOUSE_DOC = "house";
const SCOPES: Scope[] = [
  "dev.ucp.shopping.cart:manage",
  "dev.ucp.shopping.checkout:manage",
  "ucp:pay",
  "dev.ucp.shopping.order:read",
];

type HouseRecord = { id: string; clientId: string };

// Registered once and remembered; registered again if the store's clients were wiped.
export function houseClientId(): string {
  const known = get<HouseRecord>("ask_settings", HOUSE_DOC);
  if (known && get("clients", known.clientId)) return known.clientId;
  const client = registerClient({
    client_name: HOUSE_CLIENT_NAME,
    grant_types: [DEVICE_GRANT],
    token_endpoint_auth_method: "none",
  });
  put<HouseRecord>("ask_settings", HOUSE_DOC, { id: HOUSE_DOC, clientId: client.clientId });
  return client.clientId;
}

type Pending = {
  deviceCode: string;
  verificationUri: string;
  userCode: string;
  expiresAt: number;
  intervalMs: number;
  lastPollAt: number;
};
type Connection = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  customerId: string;
};

const pending = new Map<string, Pending>();
const connections = new Map<string, Connection>();

export type ConnectStart = { verificationUri: string; userCode: string; expiresIn: number };

export async function startConnect(sessionId: string, now = Date.now()): Promise<ConnectStart> {
  const answer = await startDeviceAuthorization(
    new URLSearchParams({ client_id: houseClientId(), scope: SCOPES.join(" ") }),
  );
  pending.set(sessionId, {
    deviceCode: answer.device_code,
    verificationUri: answer.verification_uri_complete,
    userCode: answer.user_code,
    expiresAt: now + answer.expires_in * 1000,
    intervalMs: answer.interval * 1000,
    lastPollAt: now,
  });
  return {
    verificationUri: answer.verification_uri_complete,
    userCode: answer.user_code,
    expiresIn: answer.expires_in,
  };
}

export const INLINE_PATH = "/api/ask/connect/inline";

// One click in the chat by the session's signed-in shopper: the device request the house client
// starts is approved at once for that shopper with the budget they picked, then redeemed like any
// agent's. The grant, its consent trace and its revocation are an outside agent's.
export async function connectInline(
  sessionId: string,
  customerId: string,
  spendLimit: number,
  now = Date.now(),
): Promise<ConnectState> {
  if (houseToken(sessionId, now)) return "connected";
  const started = await startConnect(sessionId, now);
  const verified = verifyUserCode(started.userCode, `ask:${sessionId}`);
  if ("error" in verified) {
    pending.delete(sessionId);
    return "expired";
  }
  decide({
    requestId: verified.requestId,
    customerId,
    approve: true,
    scopes: SCOPES,
    spendLimit,
    via: INLINE_PATH,
  });
  const request = pending.get(sessionId);
  if (request) request.lastPollAt = now - request.intervalMs;
  return pollConnect(sessionId, customerId, now);
}

export type ConnectState =
  | "none"
  | "pending"
  | "connected"
  | "denied"
  | "expired"
  | "other_customer";

// The browser polls; the store's token endpoint is asked no faster than its interval, so the
// shopper's panel cannot make the device request slow down.
export async function pollConnect(
  sessionId: string,
  customerId: string,
  now = Date.now(),
): Promise<ConnectState> {
  if (houseToken(sessionId, now)) return "connected";
  const request = pending.get(sessionId);
  if (!request) return "none";
  if (now > request.expiresAt) {
    pending.delete(sessionId);
    return "expired";
  }
  if (now - request.lastPollAt < request.intervalMs) return "pending";
  request.lastPollAt = now;
  let tokens: Awaited<ReturnType<typeof tokenEndpoint>>;
  try {
    tokens = await tokenEndpoint(
      new URLSearchParams({
        grant_type: DEVICE_GRANT,
        client_id: houseClientId(),
        device_code: request.deviceCode,
      }),
    );
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error;
    if (error.code === "authorization_pending") return "pending";
    if (error.code === "slow_down") {
      request.intervalMs += 5_000;
      return "pending";
    }
    pending.delete(sessionId);
    return error.code === "access_denied" ? "denied" : "expired";
  }
  pending.delete(sessionId);
  // Someone else may have typed the code: the grant must be this session's shopper's.
  const auth = authenticate(`Bearer ${tokens.access_token}`, "/mcp");
  if (!auth || auth === "invalid" || auth.grant.customerId !== customerId) {
    await revoke(tokens.refresh_token);
    return "other_customer";
  }
  connections.set(sessionId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: now + tokens.expires_in * 1000,
    customerId,
  });
  return "connected";
}

// An access token outlives a session (60 min against 30), so none is ever refreshed.
export function houseToken(sessionId: string, now = Date.now()): string | undefined {
  const connection = connections.get(sessionId);
  if (!connection) return undefined;
  if (now < connection.expiresAt) return connection.accessToken;
  connections.delete(sessionId);
  return undefined;
}

// What the session's grant still allows: the agent pays on its own only while this is defined.
export function houseAccess(
  sessionId: string,
  now = Date.now(),
): { remaining: number; pay: boolean } | undefined {
  const token = houseToken(sessionId, now);
  const auth = token ? authenticate(`Bearer ${token}`, "/mcp") : undefined;
  if (!auth || auth === "invalid" || auth.grant.revoked) return undefined;
  return {
    remaining: Math.max(0, auth.grant.spendLimit - auth.grant.spent),
    pay: auth.grant.scopes.includes("ucp:pay"),
  };
}

async function revoke(token: string | undefined) {
  if (!token) return;
  try {
    await revokeEndpoint(new URLSearchParams({ token, client_id: houseClientId() }));
  } catch {
    // A token that cannot be revoked still expires; the session no longer holds it.
  }
}

// Ending a session forgets its sign-in and revokes the grant's tokens it held.
export async function disconnect(sessionId: string): Promise<void> {
  pending.delete(sessionId);
  const connection = connections.get(sessionId);
  connections.delete(sessionId);
  await revoke(connection?.refreshToken);
}

export const forgetHouseConnections = () => {
  pending.clear();
  connections.clear();
};

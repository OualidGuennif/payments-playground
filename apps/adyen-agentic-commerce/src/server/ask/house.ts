// Spec: knowledge/components/ask-agent.md
// The house agent's identity at the store (spec invariant 2): one registered public client,
// "Atelier Velune Ask", that declares only the device grant, like any outside agent could. A
// signed-in shopper connects through the ordinary device sign-in and consent page, or with one
// click in the chat, which takes the same device grant and consent decision. The grant is the
// account's and outlives a conversation (ADR-021); its access tokens live in this process's memory
// only (the database keeps their hashes, like every token's), never in a log, the console or a page.
import { get, put } from "../core/db";
import { trace } from "../core/trace";
import {
  authenticate,
  decide,
  DEVICE_GRANT,
  type Grant,
  grants,
  issueAccessTokenForGrant,
  OAuthError,
  peekAuth,
  registerClient,
  revokeEndpoint,
  type Scope,
  startDeviceAuthorization,
  tokenEndpoint,
  updateGrant,
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
  grantId: string;
};

const pending = new Map<string, Pending>();
const connections = new Map<string, Connection>();
// Until when (ms) the browser behind each conversation last proved it is the shopper (ADR-021):
// read from its customer session at every request, so a chat payment can be judged at the call.
const proofs = new Map<string, number>();

// The account's newest live house grant; one grant may pay, so only grants that can are counted.
export function findActiveHouseGrant(customerId: string): Grant | undefined {
  const client = houseClientId();
  return grants(customerId)
    .filter((g) => g.clientId === client && !g.revoked && g.scopes.includes("ucp:pay"))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

// A live conversation of a signed-in shopper takes the account's grant back after a new
// conversation, a sign-in or a restart: a token minted for that grant, never a new or wider grant.
// Older live house grants of the account (from restarts before ADR-021) are revoked so one stays.
export function resumeHouseConnection(
  sessionId: string,
  customerId: string,
  now = Date.now(),
): boolean {
  if (houseToken(sessionId, now)) return connections.get(sessionId)?.customerId === customerId;
  const grant = findActiveHouseGrant(customerId);
  if (!grant) return false;
  const client = houseClientId();
  for (const older of grants(customerId)) {
    if (older.id === grant.id || older.clientId !== client || older.revoked) continue;
    updateGrant(older.id, { revoked: true }, customerId);
    trace({
      channel: "oauth",
      actor: HOUSE_CLIENT_NAME,
      method: "POST",
      path: "/api/ask/session",
      status: 200,
      ref: older.id,
      detail: { revoked: true, supersededBy: grant.id },
    });
  }
  const issued = issueAccessTokenForGrant(client, grant.id);
  if (!issued) return false;
  connections.set(sessionId, {
    accessToken: issued.access_token,
    expiresAt: now + issued.expires_in * 1000,
    customerId,
    grantId: grant.id,
  });
  return true;
}

// The budget of the grant the conversation holds, read live: amounts and a flag, nothing secret.
export function houseGrantInfo(sessionId: string, now = Date.now()) {
  const token = houseToken(sessionId, now);
  const auth = token ? peekAuth(`Bearer ${token}`, "/mcp") : undefined;
  if (!auth || auth === "invalid") return undefined;
  // The id lets the panel raise this grant through the account's own route and step-up.
  const { id, spendLimit, spent } = auth.grant;
  return { id, spendLimit, spent, remaining: Math.max(0, spendLimit - spent) };
}

export const noteProof = (sessionId: string, provenUntilMs: number) =>
  proofs.set(sessionId, provenUntilMs);

const proven = (sessionId: string, now: number) => now < (proofs.get(sessionId) ?? 0);

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
  // One grant per account: an active one is reused at its own limit; a higher one needs the
  // account's step-up (ADR-021).
  if (resumeHouseConnection(sessionId, customerId, now)) return "connected";
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
    grantId: auth.grant.id,
  });
  return "connected";
}

// An access token outlives a session (60 min against 30), so none is ever refreshed; a new
// conversation resumes the grant instead. A grant the shopper disconnected on the account page ends
// the connection here too: the session then reads as not connected and may connect again.
export function houseToken(sessionId: string, now = Date.now()): string | undefined {
  const connection = connections.get(sessionId);
  if (!connection) return undefined;
  const auth =
    now < connection.expiresAt ? peekAuth(`Bearer ${connection.accessToken}`, "/mcp") : undefined;
  if (auth && auth !== "invalid") return connection.accessToken;
  connections.delete(sessionId);
  return undefined;
}

// What the session's grant still allows: the agent pays on its own only while this is defined.
export function houseAccess(
  sessionId: string,
  now = Date.now(),
): { remaining: number; pay: boolean; fresh: boolean } | undefined {
  const token = houseToken(sessionId, now);
  const auth = token ? peekAuth(`Bearer ${token}`, "/mcp") : undefined;
  if (!auth || auth === "invalid") return undefined;
  return {
    remaining: Math.max(0, auth.grant.spendLimit - auth.grant.spent),
    pay: auth.grant.scopes.includes("ucp:pay"),
    fresh: proven(sessionId, now),
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

// A conversation that ends normally forgets its token and revokes that access token only: the
// grant stays the account's until the shopper disconnects it (ADR-021).
export async function detachSession(sessionId: string): Promise<void> {
  pending.delete(sessionId);
  proofs.delete(sessionId);
  const connection = connections.get(sessionId);
  connections.delete(sessionId);
  await revoke(connection?.accessToken);
}

// A lock (the guard or the console) revokes the grant the conversation held, fail closed.
export async function disconnect(sessionId: string): Promise<void> {
  pending.delete(sessionId);
  proofs.delete(sessionId);
  const connection = connections.get(sessionId);
  connections.delete(sessionId);
  await revoke(connection?.refreshToken);
  // A resumed connection holds no refresh token: its grant is revoked directly.
  const grant = connection ? get<Grant>("grants", connection.grantId) : undefined;
  if (connection && grant && !grant.revoked) {
    updateGrant(grant.id, { revoked: true }, connection.customerId);
    trace({
      channel: "oauth",
      actor: HOUSE_CLIENT_NAME,
      method: "POST",
      path: "/api/ask/session",
      status: 200,
      ref: connection.grantId,
      detail: { revoked: true, locked: true },
    });
  }
}

export const forgetHouseConnections = () => {
  pending.clear();
  connections.clear();
  proofs.clear();
};

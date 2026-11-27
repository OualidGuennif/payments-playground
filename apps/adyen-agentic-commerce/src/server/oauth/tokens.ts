// Spec: knowledge/components/adyen-agentic-commerce.md
// Access and refresh tokens: the token endpoint (codes, device codes, refresh), revoke,
// authenticate, and the grants they carry.
import { calculateJwkThumbprint } from "jose";
import { findBy, get, list, put } from "../core/db";
import { trace } from "../core/trace";
import { secret, sha256, sha256b64url } from "../core/util";
import type { Scope } from "./scopes";
import {
  ACCESS_TTL,
  type Auth,
  type Client,
  type Code,
  DEVICE_GRANT,
  type DeviceRequest,
  type Grant,
  grantedResources,
  issuer,
  limitOf,
  nowSec,
  OAuthError,
  REFRESH_TTL,
  type Token,
} from "./shared";
import { authenticateClient, clientGrants } from "./clients";

// RFC 8628 §3.5: pending, slow_down (and the interval widens by 5 s), denied, expired, or tokens
// once; the order of the checks makes a used or late code fail even if it was approved.
function deviceToken(client: Client, deviceCode: string, asked: string[]) {
  const device = get<DeviceRequest>("device_requests", sha256(deviceCode));
  if (!device || device.clientId !== client.clientId)
    throw new OAuthError("invalid_grant", "Unknown device_code");
  if (device.status === "used") throw new OAuthError("invalid_grant", "This device_code was used");
  if (device.expiresAt < nowSec())
    throw new OAuthError("expired_token", "This device_code expired; start again");
  if (device.status === "denied") throw new OAuthError("access_denied", "The shopper declined");
  // Checked before the code is spent: a poll naming another resource leaves it for a right one.
  const resources = grantedResources(device.resources, asked);
  if (device.status === "approved") {
    put("device_requests", device.id, { ...device, status: "used" });
    const grant = get<Grant>("grants", device.grantId ?? "");
    if (!grant || grant.revoked || !grant.customerId)
      throw new OAuthError("invalid_grant", "Grant revoked");
    const scopes = device.grantedScopes ?? [];
    return issueTokens(
      client.clientId,
      grant,
      { scopes, resources: device.resources },
      { scopes, resources },
    );
  }
  const now = Date.now();
  const early = device.lastPollMs !== undefined && now - device.lastPollMs < device.interval * 1000;
  const interval = early ? device.interval + 5 : device.interval;
  put("device_requests", device.id, { ...device, lastPollMs: now, interval });
  if (early) throw new OAuthError("slow_down", `Poll at most every ${interval} s`);
  throw new OAuthError("authorization_pending", "The shopper has not answered yet");
}

type Reach = { scopes: Scope[]; resources: string[] | undefined };

// RFC 6749 §6 and PAP 1.0 §4.5: a token request may narrow the access token, while the refresh
// token keeps all the grant gave, so a later refresh can ask for the rest.
function issueTokens(clientId: string, grant: Grant, granted: Reach, access: Reach = granted) {
  // The first token is when the account starts to show the agent as more than a consent.
  const current = get<Grant>("grants", grant.id);
  if (current && !current.tokenIssuedAt)
    put("grants", grant.id, { ...current, tokenIssuedAt: new Date().toISOString() });
  const accessToken = `at_${secret()}`;
  const refreshToken = `rt_${secret()}`;
  put<Token>("tokens", sha256(accessToken), {
    id: sha256(accessToken),
    kind: "access",
    clientId,
    grantId: grant.id,
    ...access,
    expiresAt: nowSec() + ACCESS_TTL,
    revoked: false,
  });
  put<Token>("tokens", sha256(refreshToken), {
    id: sha256(refreshToken),
    kind: "refresh",
    clientId,
    grantId: grant.id,
    ...granted,
    expiresAt: nowSec() + REFRESH_TTL,
    revoked: false,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope: access.scopes.join(" "),
  };
}

export async function tokenEndpoint(form: URLSearchParams) {
  const client = await authenticateClient(form);
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const raw = form.get("code") ?? "";
    const code = get<Code>("codes", sha256(raw));
    if (!code || code.used || code.expiresAt < nowSec() || code.clientId !== client.clientId) {
      throw new OAuthError("invalid_grant", "Code is invalid, used or expired");
    }
    put("codes", code.id, { ...code, used: true });
    if (form.get("redirect_uri") !== code.redirectUri)
      throw new OAuthError("invalid_grant", "redirect_uri mismatch");
    const verifier = form.get("code_verifier") ?? "";
    if (sha256b64url(verifier) !== code.codeChallenge)
      throw new OAuthError("invalid_grant", "PKCE verification failed");
    const grant = get<Grant>("grants", code.grantId);
    if (!grant || grant.revoked || !grant.customerId)
      throw new OAuthError("invalid_grant", "Grant revoked");
    const resources = grantedResources(code.resources, form.getAll("resource"));
    return issueTokens(
      client.clientId,
      grant,
      { scopes: code.scopes, resources: code.resources },
      { scopes: code.scopes, resources },
    );
  }
  if (grantType === "refresh_token") {
    const raw = form.get("refresh_token") ?? "";
    const token = get<Token>("tokens", sha256(raw));
    if (
      !token ||
      token.kind !== "refresh" ||
      token.revoked ||
      token.expiresAt < nowSec() ||
      token.clientId !== client.clientId
    ) {
      throw new OAuthError("invalid_grant", "Refresh token is invalid");
    }
    const grant = get<Grant>("grants", token.grantId);
    if (!grant || grant.revoked || !grant.customerId)
      throw new OAuthError("invalid_grant", "Grant revoked");
    const asked = (form.get("scope") ?? "").split(" ").filter(Boolean);
    if (asked.some((s) => !token.scopes.includes(s as Scope)))
      throw new OAuthError("invalid_scope", "Scope exceeds the grant");
    const resources = grantedResources(token.resources, form.getAll("resource"));
    put("tokens", token.id, { ...token, revoked: true });
    return issueTokens(
      client.clientId,
      grant,
      { scopes: token.scopes, resources: token.resources },
      { scopes: asked.length ? [...new Set(asked as Scope[])] : token.scopes, resources },
    );
  }
  if (grantType === DEVICE_GRANT) {
    if (!clientGrants(client).includes(DEVICE_GRANT))
      throw new OAuthError("unauthorized_client", `This client did not register ${DEVICE_GRANT}`);
    return deviceToken(client, form.get("device_code") ?? "", form.getAll("resource"));
  }
  throw new OAuthError(
    "unsupported_grant_type",
    `Use authorization_code, refresh_token or ${DEVICE_GRANT}`,
  );
}

export async function revokeEndpoint(form: URLSearchParams) {
  const client = await authenticateClient(form);
  const token = get<Token>("tokens", sha256(form.get("token") ?? ""));
  if (!token || token.clientId !== client.clientId) return;
  const live = !token.revoked && token.expiresAt >= nowSec();
  put("tokens", token.id, { ...token, revoked: true });
  // PAP 1.0 §4.6 and RFC 7009 §2.1: revoking the live refresh token of a sign-in is sign-out, so
  // its grant ends and every access token issued under it stops. A refresh token a refresh
  // already replaced, or an access token, ends nothing else.
  if (token.kind !== "refresh" || !live) return;
  const grant = get<Grant>("grants", token.grantId);
  if (!grant || grant.revoked) return;
  put("grants", grant.id, { ...grant, revoked: true });
  trace({
    channel: "oauth",
    actor: grant.clientName,
    method: "POST",
    path: "/oauth/revoke",
    status: 200,
    ref: grant.id,
    detail: { signedOut: true, account: grant.customerId },
  });
}

// `path` is the protected resource the request reached: "" for UCP REST, "/mcp" for MCP,
// "/mcp/code" for Code Mode. A token bound to another one is invalid here (RFC 8707 §2, RFC 6750
// §3.1).
export type ResourcePath = "" | "/mcp" | "/mcp/code";

export function authenticate(
  header: string | null,
  path: ResourcePath,
): Auth | undefined | "invalid" {
  const auth = peekAuth(header, path);
  if (!auth || auth === "invalid") return auth;
  const at = new Date().toISOString();
  put("grants", auth.grant.id, {
    ...auth.grant,
    firstUsedAt: auth.grant.firstUsedAt ?? at,
    lastUsedAt: at,
  });
  return auth;
}

// The same checks without marking the grant used: for a holder (the Ask session) asking whether
// its token still works, a revoked grant included, without making the agent look active.
export function peekAuth(header: string | null, path: ResourcePath): Auth | undefined | "invalid" {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return "invalid";
  const token = get<Token>("tokens", sha256(match[1]!));
  if (!token || token.kind !== "access" || token.revoked || token.expiresAt < nowSec())
    return "invalid";
  if (token.resources && !token.resources.includes(`${issuer()}${path}`)) return "invalid";
  const grant = get<Grant>("grants", token.grantId);
  if (!grant || grant.revoked || !grant.customerId) return "invalid";
  return { token, grant, accessToken: match[1]! };
}

// An account's grants come from a lookup by account, not list()'s window of the newest 200: an old
// grant that still works must stay on the account page, where the shopper can revoke it.
export function grants(customerId?: string): Grant[] {
  return customerId === undefined
    ? list<Grant>("grants")
    : findBy<Grant>("grants", "customerId", customerId);
}

// The grant as it stands now, not as the token found it: a payment or the shopper may have changed
// it since. A revoked grant gives no auth at all.
export function liveAuth(auth: Auth | undefined): Auth | undefined {
  const grant = auth ? get<Grant>("grants", auth.grant.id) : undefined;
  return auth && grant && !grant.revoked ? { ...auth, grant } : undefined;
}

// The account changes only its own grants; the Back Office passes no customer. A disconnected
// agent stays disconnected, so its limit no longer means anything and cannot change.
export function updateGrant(
  id: string,
  change: { revoked?: boolean; spendLimit?: number },
  customerId?: string,
): Grant | "revoked" | undefined {
  const grant = get<Grant>("grants", id);
  if (!grant || (customerId !== undefined && grant.customerId !== customerId)) return undefined;
  if (change.spendLimit !== undefined && grant.revoked) return "revoked";
  const next = {
    ...grant,
    revoked: change.revoked ?? grant.revoked,
    spendLimit: change.spendLimit !== undefined ? limitOf(change.spendLimit) : grant.spendLimit,
  };
  return put("grants", id, next);
}

export function chargeGrant(id: string, amount: number): void {
  const grant = get<Grant>("grants", id);
  if (grant) put("grants", id, { ...grant, spent: grant.spent + amount });
}

export const jwkThumbprint = calculateJwkThumbprint;

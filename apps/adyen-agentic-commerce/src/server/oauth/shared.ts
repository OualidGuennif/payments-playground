// Spec: knowledge/components/adyen-agentic-commerce.md
// What every part of the authorization server shares: its records and error, lifetimes, the issuer
// and the resources it serves, the scopes a request asks for, the spending limit.
import { type JSONWebKeySet } from "jose";
import { config } from "../core/config";
import { DEFAULT_SCOPES, isScope, type Scope } from "./scopes";

export type Client = {
  clientId: string;
  kind: "metadata-document" | "registered";
  name: string;
  redirectUris: string[];
  authMethod: "private_key_jwt" | "none";
  // Absent on clients stored before the device grant: they keep the authorization code only.
  grantTypes?: string[];
  jwksUri?: string;
  jwks?: JSONWebKeySet;
  clientUri?: string;
  fetchedAt: string;
};

export type Grant = {
  id: string;
  clientId: string;
  clientName: string;
  // The account that approved it; grants made before accounts have none and authenticate nothing.
  customerId?: string;
  scopes: Scope[];
  spendLimit: number;
  spent: number;
  revoked: boolean;
  // Consent, token and first request are three facts; the account shows which ones happened.
  createdAt: string;
  tokenIssuedAt?: string;
  firstUsedAt?: string;
  lastUsedAt?: string;
};

// A consent request: from /oauth/authorize (redirectUri, PKCE) or from a device code (device).
export type AuthRequest = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri?: string;
  device?: string;
  scopes: Scope[];
  state?: string;
  codeChallenge?: string;
  resources?: string[];
  expiresAt: number;
};

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];
export const DEVICE_TTL = 600;
export const DEVICE_INTERVAL = 5;
// Device requests kept at once, expired ones included until they are pruned.
export const DEVICE_REQUESTS_MAX = 1000;

export type DeviceRequest = {
  id: string;
  clientId: string;
  clientName: string;
  userCode: string;
  scopes: Scope[];
  resources?: string[];
  expiresAt: number;
  interval: number;
  lastPollMs?: number;
  status: "pending" | "approved" | "denied" | "used";
  grantId?: string;
  grantedScopes?: Scope[];
};

export type Code = {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  grantId: string;
  scopes: Scope[];
  resources?: string[];
  expiresAt: number;
  used: boolean;
};

export type Token = {
  id: string;
  kind: "access" | "refresh";
  clientId: string;
  grantId: string;
  scopes: Scope[];
  // RFC 8707: where the token may be used; absent means every resource the store serves.
  resources?: string[];
  expiresAt: number;
  revoked: boolean;
};

export type Auth = { token: Token; grant: Grant; accessToken: string };

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// PAP 1.0 §4.1: a Company may refuse an assertion living over 5 minutes, never one within them.
export const MAX_ASSERTION_LIFETIME = 300;
export const ASSERTION_SKEW = 60;
export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 30 * 24 * 3600;
// EUR 1000: the most an agent may spend, whether set at consent or on the account page.
export const SPEND_LIMIT_MAX = 100_000;
export const nowSec = () => Math.floor(Date.now() / 1000);
export const issuer = () => config().publicOrigin;
// Loopback client documents are accepted only while the store itself runs on a loopback origin.
export const devOrigin = () => isLoopback(new URL(issuer()));

// RFC 8707: the store serves two protected resources, its UCP REST API at the origin and its MCP
// endpoint. A value names one when it is the same URI after RFC 3986 normalisation, so the
// origin's trailing slash is the origin, while a query, a fragment or another path is not.
const servedResources = () => [issuer(), `${issuer()}/mcp`];

function servedResource(value: string): string | undefined {
  let href: string;
  try {
    href = new URL(value).href;
  } catch {
    return undefined;
  }
  return servedResources().find((r) => new URL(r).href === href);
}

// The resource parameters of a request, as served resources without repeats; none leaves the
// token good at both. Anything else is invalid_target, so no code or token is ever issued for it.
export function requestedResources(values: string[]): string[] | undefined {
  if (!values.length) return undefined;
  const resources = new Set<string>();
  for (const value of values) {
    const resource = servedResource(value);
    if (!resource)
      throw new OAuthError("invalid_target", `${value} is not a resource this store serves`);
    resources.add(resource);
  }
  return [...resources];
}

// At the token endpoint a client may narrow to resources it was granted, never reach another one.
export function grantedResources(
  granted: string[] | undefined,
  values: string[],
): string[] | undefined {
  const asked = requestedResources(values);
  if (!asked) return granted;
  if (granted && asked.some((r) => !granted.includes(r)))
    throw new OAuthError("invalid_target", "The grant was not issued for that resource");
  return asked;
}

export function isLoopback(url: URL) {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

// The scope parameter as known scopes without repeats, or the refusal's description. PAP 1.0
// §4.7 binds a PAP agent (a URL client that signs) to send scope. Any other MCP client that sends
// none, registered or a public URL client, gets the default set, as RFC 6749 §3.3 allows, since
// generic hosts often leave it out.
export function requestedScopes(param: string | null, client: Client): Scope[] | string {
  const requested = (param ?? "").split(" ").filter(Boolean);
  if (!requested.length && client.authMethod === "private_key_jwt")
    return "A sign-in request must carry scope (PAP 1.0 §4.7)";
  const unknown = requested.filter((s) => !isScope(s));
  if (unknown.length) return `Unknown scope: ${unknown.join(" ")}`;
  return [...new Set(requested.length ? (requested as Scope[]) : DEFAULT_SCOPES)];
}

// A limit that is not a number reads as no budget: NaN would compare false and never cap.
export const limitOf = (amount: number) =>
  Number.isFinite(amount) ? Math.max(0, Math.min(Math.round(amount), SPEND_LIMIT_MAX)) : 0;

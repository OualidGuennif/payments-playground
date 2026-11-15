// Spec: knowledge/components/adyen-agentic-commerce.md
// The authorization server: PAP 1.0 clients (client metadata documents + private_key_jwt) and
// generic MCP clients (RFC 7591 public clients), authorization code + PKCE S256 only.
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeJwt,
  type JSONWebKeySet,
  jwtVerify,
} from "jose";
import { config } from "./config";
import { claimJti, get, list, put } from "./db";
import { trace } from "./trace";
import { isRecord, newId, secret, sha256, sha256b64url } from "./util";

export const SCOPES = {
  "ucp:checkout": { label: "Create and update checkouts for you", kind: "changes" },
  "ucp:pay": { label: "Pay with your saved card, within the spend limit you set", kind: "changes" },
  "ucp:orders": { label: "Read your orders on this store", kind: "personal_data" },
  profile: { label: "Read your name and email address", kind: "personal_data" },
} as const;
export type Scope = keyof typeof SCOPES;
export const isScope = (value: string): value is Scope => value in SCOPES;

export type Client = {
  clientId: string;
  kind: "metadata-document" | "registered";
  name: string;
  redirectUris: string[];
  authMethod: "private_key_jwt" | "none";
  jwksUri?: string;
  jwks?: JSONWebKeySet;
  clientUri?: string;
  fetchedAt: string;
};

export type Grant = {
  id: string;
  clientId: string;
  clientName: string;
  scopes: Scope[];
  spendLimit: number;
  spent: number;
  revoked: boolean;
  createdAt: string;
  lastUsedAt?: string;
};

type AuthRequest = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopes: Scope[];
  state?: string;
  codeChallenge: string;
  resource?: string;
  expiresAt: number;
};

type Code = {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  grantId: string;
  scopes: Scope[];
  expiresAt: number;
  used: boolean;
};

export type Token = {
  id: string;
  kind: "access" | "refresh";
  clientId: string;
  grantId: string;
  scopes: Scope[];
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

const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
const nowSec = () => Math.floor(Date.now() / 1000);
export const issuer = () => config().publicOrigin;
// Loopback client documents are accepted only while the store itself runs on a loopback origin.
const devOrigin = () => isLoopback(new URL(issuer()));

export function authorizationServerMetadata() {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    registration_endpoint: `${iss}/oauth/register`,
    protected_resources: [iss, `${iss}/mcp`],
    scopes_supported: Object.keys(SCOPES),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256", "PS384"],
    revocation_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [issuer()],
    scopes_supported: Object.keys(SCOPES),
    bearer_methods_supported: ["header"],
    resource_name: "Atelier Velune store",
  };
}

// --- clients ---------------------------------------------------------------------------------

function isLoopback(url: URL) {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function sameSite(a: URL, b: URL) {
  return a.hostname === b.hostname || a.hostname.endsWith(`.${b.hostname}`);
}

async function fetchNoRedirect(url: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200)
    throw new OAuthError("invalid_client", `${url} answered ${response.status}`);
  const text = await response.text();
  if (text.length > 64_000) throw new OAuthError("invalid_client", `${url} is too large`);
  return JSON.parse(text);
}

function metadataUrlAllowed(url: URL) {
  return url.protocol === "https:" || (devOrigin() && isLoopback(url));
}

export async function resolveClient(clientId: string): Promise<Client> {
  let url: URL | undefined;
  try {
    url = new URL(clientId);
  } catch {
    /* a registered client id is not a URL */
  }
  if (!url) {
    const client = get<Client>("clients", clientId);
    if (!client) throw new OAuthError("invalid_client", "Unknown client_id");
    return client;
  }
  if (!metadataUrlAllowed(url) || url.hash || url.pathname === "/") {
    throw new OAuthError("invalid_client", "client_id must be an https URL with a path");
  }
  const cached = get<Client>("clients", clientId);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 5 * 60_000) return cached;
  const doc = await fetchNoRedirect(clientId);
  if (!isRecord(doc) || doc.client_id !== clientId) {
    throw new OAuthError("invalid_client", "The metadata document must name the same client_id");
  }
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String) : [];
  const authMethod = doc.token_endpoint_auth_method === "none" ? "none" : "private_key_jwt";
  for (const uri of redirectUris) {
    const r = new URL(uri);
    const ok =
      (sameSite(r, url) && (r.protocol === "https:" || isLoopback(r))) ||
      (authMethod === "none" && isLoopback(r));
    if (!ok)
      throw new OAuthError("invalid_client", `redirect_uri ${uri} is not on the client's domain`);
  }
  if (!redirectUris.length) throw new OAuthError("invalid_client", "redirect_uris is required");
  let jwksUri: string | undefined;
  if (authMethod === "private_key_jwt") {
    if (typeof doc.jwks_uri !== "string")
      throw new OAuthError("invalid_client", "jwks_uri is required");
    const j = new URL(doc.jwks_uri);
    if (!sameSite(j, url) || !metadataUrlAllowed(j)) {
      throw new OAuthError("invalid_client", "jwks_uri must be on the client's domain");
    }
    jwksUri = j.href;
  }
  const client: Client = {
    clientId,
    kind: "metadata-document",
    name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 80) : url.host,
    redirectUris,
    authMethod,
    jwksUri,
    clientUri: typeof doc.client_uri === "string" ? doc.client_uri : undefined,
    fetchedAt: new Date().toISOString(),
  };
  return put("clients", clientId, client);
}

export function registerClient(body: unknown): Client {
  if (!isRecord(body)) throw new OAuthError("invalid_client_metadata", "JSON body required");
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirectUris.length)
    throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  for (const uri of redirectUris) {
    let r: URL;
    try {
      r = new URL(uri);
    } catch {
      throw new OAuthError("invalid_redirect_uri", `${uri} is not a URL`);
    }
    if (r.protocol !== "https:" && !isLoopback(r) && !/^[a-z][a-z0-9+.-]*:$/.test(r.protocol)) {
      throw new OAuthError("invalid_redirect_uri", `${uri} is not allowed`);
    }
    if (r.protocol === "http:" && !isLoopback(r)) {
      throw new OAuthError("invalid_redirect_uri", "plain http is only allowed on loopback");
    }
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") {
    throw new OAuthError(
      "invalid_client_metadata",
      "Registered clients are public; use a client metadata document for private_key_jwt",
    );
  }
  const client: Client = {
    clientId: newId("mcp", 12),
    kind: "registered",
    name: typeof body.client_name === "string" ? body.client_name.slice(0, 80) : "MCP client",
    redirectUris,
    authMethod: "none",
    fetchedAt: new Date().toISOString(),
  };
  return put("clients", client.clientId, client);
}

async function clientKeys(client: Client): Promise<JSONWebKeySet> {
  if (!client.jwksUri) throw new OAuthError("invalid_client", "Client has no jwks_uri");
  const doc = await fetchNoRedirect(client.jwksUri);
  if (!isRecord(doc) || !Array.isArray(doc.keys))
    throw new OAuthError("invalid_client", "Bad JWKS");
  return doc as unknown as JSONWebKeySet;
}

export async function verifyWithClientKeys(
  client: Client,
  jwt: string,
  options: { typ?: string; audience?: string },
) {
  const keys = createLocalJWKSet(await clientKeys(client));
  return jwtVerify(jwt, keys, {
    algorithms: ["ES256", "PS384"],
    typ: options.typ,
    audience: options.audience,
  });
}

// private_key_jwt: aud must be the issuer identifier itself; lifetimes up to 300 s are accepted.
async function authenticateClient(form: URLSearchParams): Promise<Client> {
  const assertion = form.get("client_assertion");
  const assertionType = form.get("client_assertion_type");
  let clientId = form.get("client_id") ?? undefined;
  if (assertion) {
    if (assertionType !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") {
      throw new OAuthError("invalid_client", "Unsupported client_assertion_type", 401);
    }
    let claims: ReturnType<typeof decodeJwt>;
    try {
      claims = decodeJwt(assertion);
    } catch {
      throw new OAuthError("invalid_client", "Malformed client_assertion", 401);
    }
    if (!claims.iss || claims.iss !== claims.sub || (clientId && clientId !== claims.iss)) {
      throw new OAuthError("invalid_client", "iss and sub must be the client_id", 401);
    }
    clientId = claims.iss;
    const client = await resolveClient(clientId);
    if (client.authMethod !== "private_key_jwt")
      throw new OAuthError("invalid_client", "Client is public", 401);
    let payload: Awaited<ReturnType<typeof verifyWithClientKeys>>["payload"];
    try {
      ({ payload } = await verifyWithClientKeys(client, assertion, {}));
    } catch (error) {
      throw new OAuthError(
        "invalid_client",
        `client_assertion rejected: ${(error as Error).message}`,
        401,
      );
    }
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(issuer()))
      throw new OAuthError("invalid_client", "aud must be the issuer", 401);
    if (typeof payload.exp !== "number")
      throw new OAuthError("invalid_client", "exp is required", 401);
    if (typeof payload.iat === "number" && payload.exp - payload.iat > 3600) {
      throw new OAuthError("invalid_client", "client_assertion lifetime is too long", 401);
    }
    if (
      typeof payload.jti !== "string" ||
      !claimJti(`ca:${clientId}:${payload.jti}`, payload.exp)
    ) {
      throw new OAuthError("invalid_client", "client_assertion jti missing or replayed", 401);
    }
    return client;
  }
  if (!clientId) throw new OAuthError("invalid_client", "client authentication required", 401);
  const client = await resolveClient(clientId);
  if (client.authMethod !== "none")
    throw new OAuthError("invalid_client", "client_assertion required", 401);
  return client;
}

// --- authorize and consent ---------------------------------------------------------------------

export type AuthorizeOutcome =
  | { kind: "consent"; requestId: string }
  | { kind: "redirect"; location: string }
  | { kind: "error"; status: number; error: string; description: string };

function errorRedirect(redirectUri: string, error: string, description: string, state?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer());
  return url.href;
}

export async function startAuthorization(params: URLSearchParams): Promise<AuthorizeOutcome> {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  let client: Client;
  try {
    client = await resolveClient(clientId);
  } catch (error) {
    return {
      kind: "error",
      status: 400,
      error: "invalid_client",
      description: (error as Error).message,
    };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return {
      kind: "error",
      status: 400,
      error: "invalid_request",
      description: "redirect_uri is not registered",
    };
  }
  const state = params.get("state") ?? undefined;
  const fail = (error: string, description: string): AuthorizeOutcome => ({
    kind: "redirect",
    location: errorRedirect(redirectUri, error, description, state),
  });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only code");
  const challenge = params.get("code_challenge");
  if (!challenge || params.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "PKCE with S256 is required");
  }
  const requested = (params.get("scope") ?? "").split(" ").filter(Boolean);
  const unknown = requested.filter((s) => !isScope(s));
  if (unknown.length) return fail("invalid_scope", `Unknown scope: ${unknown.join(" ")}`);
  const scopes = (requested.length ? requested : ["ucp:checkout", "ucp:pay"]) as Scope[];
  const request: AuthRequest = {
    id: newId("ar", 18),
    clientId,
    clientName: client.name,
    redirectUri,
    scopes: [...new Set(scopes)],
    state,
    codeChallenge: challenge,
    resource: params.get("resource") ?? undefined,
    expiresAt: nowSec() + 600,
  };
  put("auth_requests", request.id, request);
  return { kind: "consent", requestId: request.id };
}

export function pendingRequest(
  id: string,
): (AuthRequest & { client: Client | undefined }) | undefined {
  const request = get<AuthRequest>("auth_requests", id);
  if (!request || request.expiresAt < nowSec()) return undefined;
  return { ...request, client: get<Client>("clients", request.clientId) };
}

export function decide(input: {
  requestId: string;
  approve: boolean;
  scopes: string[];
  spendLimit: number;
}): string {
  const request = pendingRequest(input.requestId);
  if (!request)
    throw new OAuthError(
      "invalid_request",
      "This sign-in request expired. Start again from your agent.",
    );
  put("auth_requests", request.id, { ...request, expiresAt: 0 });
  if (!input.approve) {
    return errorRedirect(
      request.redirectUri,
      "access_denied",
      "The shopper declined",
      request.state,
    );
  }
  // Never grant more than asked: the shopper may only narrow the requested scopes.
  const scopes = request.scopes.filter((s) => input.scopes.includes(s));
  if (!scopes.length)
    return errorRedirect(request.redirectUri, "access_denied", "No scope approved", request.state);
  const limit = Math.max(0, Math.min(Math.round(input.spendLimit), 100_000));
  const grant: Grant = {
    id: newId("gr"),
    clientId: request.clientId,
    clientName: request.clientName,
    scopes,
    spendLimit: limit,
    spent: 0,
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  put("grants", grant.id, grant);
  const code = secret();
  put<Code>("codes", sha256(code), {
    id: sha256(code),
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    grantId: grant.id,
    scopes,
    expiresAt: nowSec() + 120,
    used: false,
  });
  trace({
    channel: "oauth",
    actor: request.clientName,
    method: "CONSENT",
    path: "/oauth/authorize",
    status: 302,
    ref: grant.id,
    detail: { scopes, spendLimit: limit },
  });
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", issuer());
  return url.href;
}

// --- tokens ------------------------------------------------------------------------------------

function issueTokens(clientId: string, grant: Grant, scopes: Scope[]) {
  const access = `at_${secret()}`;
  const refresh = `rt_${secret()}`;
  put<Token>("tokens", sha256(access), {
    id: sha256(access),
    kind: "access",
    clientId,
    grantId: grant.id,
    scopes,
    expiresAt: nowSec() + ACCESS_TTL,
    revoked: false,
  });
  put<Token>("tokens", sha256(refresh), {
    id: sha256(refresh),
    kind: "refresh",
    clientId,
    grantId: grant.id,
    scopes,
    expiresAt: nowSec() + REFRESH_TTL,
    revoked: false,
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope: scopes.join(" "),
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
    if (!grant || grant.revoked) throw new OAuthError("invalid_grant", "Grant revoked");
    return issueTokens(client.clientId, grant, code.scopes);
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
    if (!grant || grant.revoked) throw new OAuthError("invalid_grant", "Grant revoked");
    const asked = (form.get("scope") ?? "").split(" ").filter(Boolean);
    if (asked.some((s) => !token.scopes.includes(s as Scope)))
      throw new OAuthError("invalid_scope", "Scope exceeds the grant");
    put("tokens", token.id, { ...token, revoked: true });
    return issueTokens(client.clientId, grant, asked.length ? (asked as Scope[]) : token.scopes);
  }
  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

export async function revokeEndpoint(form: URLSearchParams) {
  const client = await authenticateClient(form);
  const token = get<Token>("tokens", sha256(form.get("token") ?? ""));
  if (token && token.clientId === client.clientId)
    put("tokens", token.id, { ...token, revoked: true });
}

export function authenticate(header: string | null): Auth | undefined | "invalid" {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return "invalid";
  const token = get<Token>("tokens", sha256(match[1]!));
  if (!token || token.kind !== "access" || token.revoked || token.expiresAt < nowSec())
    return "invalid";
  const grant = get<Grant>("grants", token.grantId);
  if (!grant || grant.revoked) return "invalid";
  put("grants", grant.id, { ...grant, lastUsedAt: new Date().toISOString() });
  return { token, grant, accessToken: match[1]! };
}

export function grants(): Grant[] {
  return list<Grant>("grants");
}

export function updateGrant(
  id: string,
  change: { revoked?: boolean; spendLimit?: number },
): Grant | undefined {
  const grant = get<Grant>("grants", id);
  if (!grant) return undefined;
  const next = {
    ...grant,
    revoked: change.revoked ?? grant.revoked,
    spendLimit:
      change.spendLimit !== undefined
        ? Math.max(0, Math.round(change.spendLimit))
        : grant.spendLimit,
  };
  return put("grants", id, next);
}

export function chargeGrant(id: string, amount: number): void {
  const grant = get<Grant>("grants", id);
  if (grant) put("grants", id, { ...grant, spent: grant.spent + amount });
}

export const jwkThumbprint = calculateJwkThumbprint;

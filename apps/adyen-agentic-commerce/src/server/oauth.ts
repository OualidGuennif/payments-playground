// Spec: knowledge/components/adyen-agentic-commerce.md
// The authorization server: PAP 1.0 clients (client metadata documents + private_key_jwt) and
// generic MCP clients (RFC 7591 public clients); authorization code + PKCE S256, or the device
// authorization grant (RFC 8628) for clients that declare it.
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeJwt,
  type JSONWebKeySet,
  jwtVerify,
} from "jose";
import { config } from "./config";
import { claimJti, count, findBy, get, list, put, removeExpired } from "./db";
import { assertPublicHost, OutboundRefused } from "./outbound";
import { trace } from "./trace";
import { isRecord, newId, secret, sha256, sha256b64url } from "./util";

const SCOPE_NAMES = [
  "dev.ucp.shopping.cart:manage",
  "dev.ucp.shopping.checkout:manage",
  "ucp:pay",
  "dev.ucp.shopping.order:read",
  "profile",
  "ucp:checkout",
  "ucp:orders",
] as const;
export type Scope = (typeof SCOPE_NAMES)[number];

type ScopeInfo = {
  // What the consent page and the account page show the shopper.
  short: string;
  // The longer line agents read in poppy.json and the OpenAPI flows.
  label: string;
  // For agents only (PAP 1.0 §4.7): whether the task works without the scope.
  withoutIt: string;
  // PAP 1.0 §4.7 hints.
  changes: "none" | "reversible" | "irreversible";
  personalData: boolean;
  // A name from before the UCP names: accepted and honoured, never advertised.
  standsFor?: readonly Scope[];
};

// Personal data marks what an agent can see or change about the shopper: a checkout fills in and
// can change their delivery details; a cart holds only what the agent itself sends.
export const SCOPES: Record<Scope, ScopeInfo> = {
  "dev.ucp.shopping.cart:manage": {
    short: "Fill and edit your cart",
    label: "Create, update and cancel carts for you",
    withoutIt: "Signed out, an agent can still build a guest cart.",
    changes: "reversible",
    personalData: false,
  },
  "dev.ucp.shopping.checkout:manage": {
    short: "Check out with your delivery address",
    label: "Create, update and cancel checkouts for you, with your delivery details",
    withoutIt: "Signed out, an agent can still check out as a guest.",
    changes: "reversible",
    personalData: true,
  },
  "ucp:pay": {
    short: "Pay with your saved card, up to your budget",
    label: "Pay with your saved card, within the spend limit you set",
    withoutIt:
      "Only the saved card needs it: an agent's own network token, or the shopper at continue_url, pays without it.",
    changes: "irreversible",
    personalData: true,
  },
  "dev.ucp.shopping.order:read": {
    short: "See the orders it placed",
    label: "Read the orders it placed for you",
    withoutIt: "Every order read needs it.",
    changes: "none",
    personalData: true,
  },
  profile: {
    short: "See your name and email",
    label: "Read your name and email address",
    withoutIt: "Shopping works without it; orders then show no buyer.",
    changes: "none",
    personalData: true,
  },
  "ucp:checkout": {
    short: "Fill your cart and check out with your delivery address",
    label: "Create, update and cancel carts and checkouts for you, with your delivery details",
    withoutIt: "Signed out, an agent can still use guest carts and checkouts.",
    changes: "reversible",
    personalData: true,
    standsFor: ["dev.ucp.shopping.cart:manage", "dev.ucp.shopping.checkout:manage"],
  },
  "ucp:orders": {
    short: "See the orders it placed",
    label: "Read the orders it placed for you",
    withoutIt: "Every order read needs it.",
    changes: "none",
    personalData: true,
    standsFor: ["dev.ucp.shopping.order:read"],
  },
};
// The description agents read in poppy.json and the OpenAPI flows.
export const agentScopeDescription = (scope: Scope) =>
  `${SCOPES[scope].label}. ${SCOPES[scope].withoutIt}`;
export const isScope = (value: string): value is Scope =>
  (SCOPE_NAMES as readonly string[]).includes(value);
export const ADVERTISED_SCOPES: Scope[] = SCOPE_NAMES.filter((s) => !SCOPES[s].standsFor);
// What an agent gets when it asks for no scope: enough to build a checkout and pay.
const DEFAULT_SCOPES: Scope[] = [
  "dev.ucp.shopping.cart:manage",
  "dev.ucp.shopping.checkout:manage",
  "ucp:pay",
];

// Whether the scopes a token carries cover `needed`, directly or through a legacy name.
export function allows(granted: readonly Scope[], needed: Scope): boolean {
  return granted.some((s) => s === needed || SCOPES[s].standsFor?.includes(needed));
}

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
type AuthRequest = {
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
const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];
const DEVICE_TTL = 600;
const DEVICE_INTERVAL = 5;
// Device requests kept at once, expired ones included until they are pruned.
export const DEVICE_REQUESTS_MAX = 1000;

type DeviceRequest = {
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

type Code = {
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
const MAX_ASSERTION_LIFETIME = 300;
const ASSERTION_SKEW = 60;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
// EUR 1000: the most an agent may spend, whether set at consent or on the account page.
export const SPEND_LIMIT_MAX = 100_000;
const nowSec = () => Math.floor(Date.now() / 1000);
export const issuer = () => config().publicOrigin;
// Loopback client documents are accepted only while the store itself runs on a loopback origin.
const devOrigin = () => isLoopback(new URL(issuer()));

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
function requestedResources(values: string[]): string[] | undefined {
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
function grantedResources(granted: string[] | undefined, values: string[]): string[] | undefined {
  const asked = requestedResources(values);
  if (!asked) return granted;
  if (granted && asked.some((r) => !granted.includes(r)))
    throw new OAuthError("invalid_target", "The grant was not issued for that resource");
  return asked;
}

export function authorizationServerMetadata() {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    device_authorization_endpoint: `${iss}/oauth/device_authorization`,
    token_endpoint: `${iss}/oauth/token`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    registration_endpoint: `${iss}/oauth/register`,
    protected_resources: [iss, `${iss}/mcp`],
    scopes_supported: ADVERTISED_SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: [...DEFAULT_GRANT_TYPES, DEVICE_GRANT],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    token_endpoint_auth_signing_alg_values_supported: CLIENT_ASSERTION_ALGS,
    revocation_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [issuer()],
    scopes_supported: ADVERTISED_SCOPES,
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

// A client's documents and keys are the agent's to serve: whatever goes wrong fetching or reading
// them is the client's failure, never the store's.
async function fetchNoRedirect(url: string): Promise<unknown> {
  try {
    await assertPublicHost(new URL(url));
    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new OAuthError("invalid_client", `${url} answered ${response.status}`);
    }
    const text = await response.text();
    if (text.length > 64_000) throw new OAuthError("invalid_client", `${url} is too large`);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    if (error instanceof OutboundRefused) throw new OAuthError("invalid_client", error.message);
    throw new OAuthError("invalid_client", `${url} could not be fetched or read`);
  }
}

const urlOrUndefined = (value: unknown) => {
  try {
    return typeof value === "string" ? new URL(value) : undefined;
  } catch {
    return undefined;
  }
};

// Client metadata documents and UCP platform profiles: https, or loopback on a loopback store.
export function metadataUrlAllowed(url: URL) {
  return url.protocol === "https:" || (devOrigin() && isLoopback(url));
}

const SUPPORTED_GRANTS = [...DEFAULT_GRANT_TYPES, DEVICE_GRANT];

// RFC 7591 §2: without grant_types a client uses the authorization code (and its refresh).
function grantTypesOf(value: unknown): string[] | undefined {
  if (value === undefined) return DEFAULT_GRANT_TYPES;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return undefined;
  return [...new Set(value as string[])];
}

const clientGrants = (client: Client) => client.grantTypes ?? DEFAULT_GRANT_TYPES;

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
  const grantTypes = (grantTypesOf(doc.grant_types) ?? DEFAULT_GRANT_TYPES).filter((g) =>
    SUPPORTED_GRANTS.includes(g),
  );
  for (const uri of redirectUris) {
    const r = urlOrUndefined(uri);
    // RFC 8252 §7.3: a native agent's loopback callback is on the User's own device, whatever the
    // host of its client document.
    const ok = r && !r.hash && (isLoopback(r) || (sameSite(r, url) && r.protocol === "https:"));
    if (!ok)
      throw new OAuthError("invalid_client", `redirect_uri ${uri} is not on the client's domain`);
  }
  if (!grantTypes.length) throw new OAuthError("invalid_client", "No supported grant_types");
  if (!redirectUris.length && grantTypes.includes("authorization_code"))
    throw new OAuthError("invalid_client", "redirect_uris is required");
  let jwksUri: string | undefined;
  if (authMethod === "private_key_jwt") {
    const j = urlOrUndefined(doc.jwks_uri);
    if (!j) throw new OAuthError("invalid_client", "jwks_uri is required");
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
    grantTypes,
    jwksUri,
    clientUri: typeof doc.client_uri === "string" ? doc.client_uri : undefined,
    fetchedAt: new Date().toISOString(),
  };
  return put("clients", clientId, client);
}

export function registerClient(body: unknown): Client {
  if (!isRecord(body)) throw new OAuthError("invalid_client_metadata", "JSON body required");
  const grantTypes = grantTypesOf(body.grant_types);
  if (!grantTypes?.length || grantTypes.some((g) => !SUPPORTED_GRANTS.includes(g))) {
    throw new OAuthError(
      "invalid_client_metadata",
      `grant_types may only hold ${SUPPORTED_GRANTS.join(", ")}`,
    );
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  // A device-only client has no browser callback; any other client needs one.
  if (!redirectUris.length && grantTypes.includes("authorization_code"))
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
    grantTypes,
    fetchedAt: new Date().toISOString(),
  };
  return put("clients", client.clientId, client);
}

// Every signed request would otherwise fetch the agent's keys. A key id the cached set lacks may
// be a rotation, so it refetches the set, at most once a minute, which keeps a stream of unknown
// kids from turning into a stream of fetches.
const KEYS_TTL_MS = 5 * 60_000;
const KEYS_REFETCH_MS = 60_000;
const KEY_SETS_MAX = 1000;
const keySets = new Map<string, { keys: JSONWebKeySet; fetchedAt: number }>();

export const forgetClientKeys = () => keySets.clear();

async function clientKeys(client: Client, refresh = false): Promise<JSONWebKeySet> {
  const uri = client.jwksUri;
  if (!uri) throw new OAuthError("invalid_client", "Client has no jwks_uri");
  const cached = keySets.get(uri);
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age < (refresh ? KEYS_REFETCH_MS : KEYS_TTL_MS)) return cached.keys;
  const doc = await fetchNoRedirect(uri);
  if (!isRecord(doc) || !Array.isArray(doc.keys))
    throw new OAuthError("invalid_client", "Bad JWKS");
  keySets.delete(uri);
  if (keySets.size >= KEY_SETS_MAX) keySets.delete(keySets.keys().next().value!);
  keySets.set(uri, { keys: doc as unknown as JSONWebKeySet, fetchedAt: Date.now() });
  return doc as unknown as JSONWebKeySet;
}

// RFC 7523 leaves a client assertion's algorithm to the server, and an MCP client known by its
// client metadata document may sign with none of PAP's two. Asymmetric only: the store holds no
// client secret, so an HMAC (or `none`) could only be a forgery.
export const CLIENT_ASSERTION_ALGS = ["ES256", "ES384", "PS256", "PS384", "RS256", "EdDSA"];

// `algorithms` is required: each caller names what its protocol allows for this JWT.
export async function verifyWithClientKeys(
  client: Client,
  jwt: string,
  options: { typ?: string; audience?: string; algorithms: string[] },
) {
  const verify = async (keys: JSONWebKeySet) =>
    jwtVerify(jwt, createLocalJWKSet(keys), {
      algorithms: options.algorithms,
      typ: options.typ,
      audience: options.audience,
    });
  try {
    return await verify(await clientKeys(client));
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
    return verify(await clientKeys(client, true));
  }
}

// What a client assertion's aud may be (ADR-016): the issuer, with or without one final slash, or
// the token endpoint, each exactly.
function assertionAudiences() {
  const iss = issuer();
  return [iss, `${iss}/`, `${iss}/oauth/token`];
}
const AUDIENCE_NAMES = ["issuer", "issuer with slash", "token endpoint"];

// Which accepted form a verified request's assertion used, for the trace: ADR-016 is revisited once
// the form ChatGPT sends is known. Call it only after authenticateClient accepted the request.
export function assertionAudienceUsed(form: URLSearchParams): string | undefined {
  const assertion = form.get("client_assertion");
  if (!assertion) return undefined;
  try {
    const at = assertionAudiences().indexOf(String(decodeJwt(assertion).aud));
    return at < 0 ? undefined : AUDIENCE_NAMES[at];
  } catch {
    return undefined;
  }
}

// The refused aud goes back to the client and into the public trace: RFC 6749 §5.2 allows only
// printable ASCII without `"` or `\` in error_description, and the client chose the value.
function shownAudience(aud: unknown) {
  if (aud === undefined) return "no aud";
  const text = Array.isArray(aud) ? `[${aud.map(String).join(", ")}]` : String(aud);
  return text.replace(/[^\x20-\x7e]|["\\]/g, "?").slice(0, 200);
}

// private_key_jwt: aud is checked against assertionAudiences; lifetimes up to 300 s are accepted.
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
    const client = await resolveClient(clientId).catch((error) => {
      // RFC 6749 §5.2: a client that cannot be authenticated is 401, whatever the reason.
      throw error instanceof OAuthError ? new OAuthError(error.code, error.message, 401) : error;
    });
    if (client.authMethod !== "private_key_jwt")
      throw new OAuthError("invalid_client", "Client is public", 401);
    let payload: Awaited<ReturnType<typeof verifyWithClientKeys>>["payload"];
    try {
      ({ payload } = await verifyWithClientKeys(client, assertion, {
        algorithms: CLIENT_ASSERTION_ALGS,
      }));
    } catch (error) {
      throw new OAuthError(
        "invalid_client",
        `client_assertion rejected: ${(error as Error).message}`,
        401,
      );
    }
    // PAP 1.0 §4.1 (draft-ietf-oauth-rfc7523bis) allows only the issuer. ADR-016, owner decision
    // 2026-11-18: the token endpoint URL too (RFC 7523 §3, OpenID Connect Core §9), which ChatGPT's
    // MCP connector needs. Never an array: one could name another Company's endpoint as well.
    if (typeof payload.aud !== "string" || !assertionAudiences().includes(payload.aud)) {
      throw new OAuthError(
        "invalid_client",
        `aud must be the issuer or the token endpoint, as one string; got ${shownAudience(payload.aud)}`,
        401,
      );
    }
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number")
      throw new OAuthError("invalid_client", "iat and exp are required", 401);
    if (payload.exp - payload.iat > MAX_ASSERTION_LIFETIME) {
      throw new OAuthError("invalid_client", "client_assertion lifetime is over 300 s", 401);
    }
    // Without this a future iat would let an assertion signed today be used much later.
    if (payload.iat > nowSec() + ASSERTION_SKEW)
      throw new OAuthError("invalid_client", "client_assertion iat is in the future", 401);
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

// Exact, except that RFC 8252 §7.3 lets a loopback redirect take any port: a native agent listens
// on whichever port is free when it signs in.
function redirectMatches(registered: string, asked: string): boolean {
  if (registered === asked) return true;
  const r = urlOrUndefined(registered);
  const a = urlOrUndefined(asked);
  if (!r || !a || !isLoopback(r) || !isLoopback(a) || a.hash) return false;
  r.port = "";
  a.port = "";
  return r.href === a.href;
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
  if (!client.redirectUris.some((registered) => redirectMatches(registered, redirectUri))) {
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
  const scopes = requestedScopes(params.get("scope"), client);
  if (typeof scopes === "string") return fail("invalid_scope", scopes);
  let resources: string[] | undefined;
  try {
    resources = requestedResources(params.getAll("resource"));
  } catch (error) {
    return fail("invalid_target", (error as Error).message);
  }
  const request: AuthRequest = {
    id: newId("ar", 18),
    clientId,
    clientName: client.name,
    redirectUri,
    scopes,
    state,
    codeChallenge: challenge,
    resources,
    expiresAt: nowSec() + 600,
  };
  put("auth_requests", request.id, request);
  return { kind: "consent", requestId: request.id };
}

// The scope parameter as known scopes without repeats, or the refusal's description. PAP 1.0
// §4.7 binds a PAP agent (a URL client that signs) to send scope. Any other MCP client that sends
// none, registered or a public URL client, gets the default set, as RFC 6749 §3.3 allows, since
// generic hosts often leave it out.
function requestedScopes(param: string | null, client: Client): Scope[] | string {
  const requested = (param ?? "").split(" ").filter(Boolean);
  if (!requested.length && client.authMethod === "private_key_jwt")
    return "A sign-in request must carry scope (PAP 1.0 §4.7)";
  const unknown = requested.filter((s) => !isScope(s));
  if (unknown.length) return `Unknown scope: ${unknown.join(" ")}`;
  return [...new Set(requested.length ? (requested as Scope[]) : DEFAULT_SCOPES)];
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
  customerId: string;
  approve: boolean;
  scopes: string[];
  spendLimit: number;
}): string {
  if (!input.customerId) throw new OAuthError("access_denied", "Sign in to approve an agent");
  const request = pendingRequest(input.requestId);
  if (!request)
    throw new OAuthError(
      "invalid_request",
      "This sign-in request expired. Start again from your agent.",
    );
  put("auth_requests", request.id, { ...request, expiresAt: 0 });
  const device = request.device ? pendingDevice(request.device) : undefined;
  if (request.device && !device)
    throw new OAuthError("invalid_request", "This code expired. Ask your agent for a new one.");
  // Never grant more than asked: the shopper may only narrow the requested scopes.
  const scopes = request.scopes.filter((s) => input.scopes.includes(s));
  if (!input.approve || !scopes.length) {
    const why = input.approve ? "No scope approved" : "The shopper declined";
    if (device) {
      put("device_requests", device.id, { ...device, status: "denied" });
      return `${issuer()}/device?done=denied`;
    }
    return errorRedirect(request.redirectUri!, "access_denied", why, request.state);
  }
  const limit = limitOf(input.spendLimit);
  const grant: Grant = {
    id: newId("gr"),
    clientId: request.clientId,
    clientName: request.clientName,
    customerId: input.customerId,
    scopes,
    spendLimit: limit,
    spent: 0,
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  put("grants", grant.id, grant);
  trace({
    channel: "oauth",
    actor: request.clientName,
    method: "CONSENT",
    path: device ? "/device" : "/oauth/authorize",
    status: device ? 303 : 302,
    ref: grant.id,
    detail: { scopes, spendLimit: limit, account: input.customerId },
  });
  // A device code waits for its agent's next poll; a code goes back on the redirect.
  if (device) {
    put("device_requests", device.id, {
      ...device,
      status: "approved",
      grantId: grant.id,
      grantedScopes: scopes,
    });
    return `${issuer()}/device?done=approved`;
  }
  const code = secret();
  put<Code>("codes", sha256(code), {
    id: sha256(code),
    clientId: request.clientId,
    redirectUri: request.redirectUri!,
    codeChallenge: request.codeChallenge!,
    grantId: grant.id,
    scopes,
    resources: request.resources,
    expiresAt: nowSec() + 120,
    used: false,
  });
  const url = new URL(request.redirectUri!);
  url.searchParams.set("code", code);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", issuer());
  return url.href;
}

// --- device authorization (RFC 8628) -----------------------------------------------------------

// RFC 8628 §6.1: no vowels, so a code never spells a word, and nothing that reads as a digit.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

function newUserCode(): string {
  const letters: string[] = [];
  while (letters.length < 8) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!;
    // 240 is the largest multiple of 20 below 256: dropping the rest keeps every letter as likely.
    if (byte < 240) letters.push(USER_CODE_ALPHABET[byte % 20]!);
  }
  return letters.join("");
}

export const formatUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

function pendingDevice(id: string): DeviceRequest | undefined {
  const device = get<DeviceRequest>("device_requests", id);
  return device?.status === "pending" && device.expiresAt >= nowSec() ? device : undefined;
}

// Starts a device sign-in for a client that declared the grant; returns the RFC 8628 §3.2 answer.
export async function startDeviceAuthorization(form: URLSearchParams) {
  const client = await authenticateClient(form);
  if (!clientGrants(client).includes(DEVICE_GRANT))
    throw new OAuthError(
      "unauthorized_client",
      `Register with grant_types including ${DEVICE_GRANT}`,
    );
  // A URL client_id is shown to the shopper as a verified host. Without a callback on that host,
  // only a signed assertion proves the caller runs it; anyone could start a public one's sign-in.
  if (client.kind === "metadata-document" && client.authMethod === "none")
    throw new OAuthError(
      "unauthorized_client",
      "A client identified by a URL signs its device requests (private_key_jwt)",
    );
  const scopes = requestedScopes(form.get("scope"), client);
  if (typeof scopes === "string") throw new OAuthError("invalid_scope", scopes);
  const resources = requestedResources(form.getAll("resource"));
  // An expired request still answers a late poll with expired_token; one lifetime later it goes.
  removeExpired("device_requests", nowSec() - DEVICE_TTL);
  // The per-address limit cannot stop a caller with many addresses (an IPv6 prefix, a botnet):
  // this bounds the store and every user-code scan whatever the addresses, at the cost of new
  // starts during a flood.
  if (count("device_requests") >= DEVICE_REQUESTS_MAX)
    throw new OAuthError(
      "temporarily_unavailable",
      "Too many device sign-ins in progress; try again later",
      503,
    );
  const deviceCode = secret();
  let userCode = newUserCode();
  // Two pending requests must never share a user code; with 20^8 codes a retry is rare.
  while (
    findBy<DeviceRequest>("device_requests", "userCode", userCode).some((d) => pendingDevice(d.id))
  )
    userCode = newUserCode();
  put<DeviceRequest>("device_requests", sha256(deviceCode), {
    id: sha256(deviceCode),
    clientId: client.clientId,
    clientName: client.name,
    userCode,
    scopes,
    resources,
    expiresAt: nowSec() + DEVICE_TTL,
    interval: DEVICE_INTERVAL,
    status: "pending",
  });
  const verification = `${issuer()}/device`;
  return {
    device_code: deviceCode,
    user_code: formatUserCode(userCode),
    verification_uri: verification,
    verification_uri_complete: `${verification}?user_code=${formatUserCode(userCode)}`,
    expires_in: DEVICE_TTL,
    interval: DEVICE_INTERVAL,
  };
}

const CODE_WINDOW_MS = 10 * 60_000;
const CODE_MISSES_PER_ADDRESS = 10;
const CODE_MISSES_TOTAL = 200;
// A caller can hold many addresses (an IPv6 prefix, or any header on a run without Cloudflare), so
// the map is capped and keys are cut short: otherwise each would stay in memory for the process.
const CODE_MISS_ADDRESSES = 1000;
const codeMisses = new Map<string, number[]>();

function recentMisses(key: string, now: number): number[] {
  const kept = (codeMisses.get(key) ?? []).filter((t) => now - t < CODE_WINDOW_MS);
  if (kept.length) codeMisses.set(key, kept);
  else codeMisses.delete(key);
  return kept;
}

function recordMiss(key: string, now: number) {
  const kept = recentMisses(key, now);
  if (!codeMisses.has(key) && codeMisses.size >= CODE_MISS_ADDRESSES) {
    // Maps iterate in insertion order: the oldest address goes, never the total.
    for (const oldest of codeMisses.keys()) {
      if (oldest !== "*") {
        codeMisses.delete(oldest);
        break;
      }
    }
  }
  codeMisses.set(key, [...kept, now]);
}

export const trackedMissAddresses = () => codeMisses.size;
// Each test starts with no misses, whatever ran before it.
export const forgetCodeMisses = () => codeMisses.clear();

// The shopper's typed code becomes a consent request. Wrong codes are counted per address and in
// total; past either limit every code is refused, a right one included, so guessing cannot win.
export function verifyUserCode(
  raw: string,
  address: string,
): { requestId: string } | { error: "invalid_code" | "too_many_attempts" } {
  const now = Date.now();
  // Prefixed so that no address can be the "*" total.
  const from = `a:${address.slice(0, 64)}`;
  if (
    recentMisses(from, now).length >= CODE_MISSES_PER_ADDRESS ||
    recentMisses("*", now).length >= CODE_MISSES_TOTAL
  )
    return { error: "too_many_attempts" };
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "");
  const device = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code)
    ? findBy<DeviceRequest>("device_requests", "userCode", code)
        .map((d) => pendingDevice(d.id))
        .find(Boolean)
    : undefined;
  if (!device) {
    for (const key of [from, "*"]) recordMiss(key, now);
    return { error: "invalid_code" };
  }
  const request: AuthRequest = {
    id: newId("ar", 18),
    clientId: device.clientId,
    clientName: device.clientName,
    device: device.id,
    scopes: device.scopes,
    resources: device.resources,
    expiresAt: device.expiresAt,
  };
  put("auth_requests", request.id, request);
  return { requestId: request.id };
}

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

// --- tokens ------------------------------------------------------------------------------------

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

// `path` is the protected resource the request reached: "" for UCP REST, "/mcp" for MCP. A token
// bound to the other one is invalid here (RFC 8707 §2, RFC 6750 §3.1).
export function authenticate(
  header: string | null,
  path: "" | "/mcp",
): Auth | undefined | "invalid" {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return "invalid";
  const token = get<Token>("tokens", sha256(match[1]!));
  if (!token || token.kind !== "access" || token.revoked || token.expiresAt < nowSec())
    return "invalid";
  if (token.resources && !token.resources.includes(`${issuer()}${path}`)) return "invalid";
  const grant = get<Grant>("grants", token.grantId);
  if (!grant || grant.revoked || !grant.customerId) return "invalid";
  const at = new Date().toISOString();
  put("grants", grant.id, { ...grant, firstUsedAt: grant.firstUsedAt ?? at, lastUsedAt: at });
  return { token, grant, accessToken: match[1]! };
}

// An account's grants come from a lookup by account, not list()'s window of the newest 200: an old
// grant that still works must stay on the account page, where the shopper can revoke it.
export function grants(customerId?: string): Grant[] {
  return customerId === undefined
    ? list<Grant>("grants")
    : findBy<Grant>("grants", "customerId", customerId);
}

export const limitOf = (amount: number) =>
  Math.max(0, Math.min(Math.round(amount), SPEND_LIMIT_MAX));

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

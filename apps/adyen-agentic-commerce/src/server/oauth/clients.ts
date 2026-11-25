// Spec: knowledge/components/adyen-agentic-commerce.md
// Who a client is: metadata documents, RFC 7591 registration, client keys and private_key_jwt
// authentication.
import { createLocalJWKSet, decodeJwt, type JSONWebKeySet, jwtVerify } from "jose";
import { claimJti, get, put } from "../core/db";
import { assertPublicHost, OutboundRefused } from "../core/outbound";
import { isRecord, newId } from "../core/util";
import {
  ASSERTION_SKEW,
  type Client,
  DEFAULT_GRANT_TYPES,
  DEVICE_GRANT,
  devOrigin,
  isLoopback,
  issuer,
  MAX_ASSERTION_LIFETIME,
  nowSec,
  OAuthError,
} from "./shared";

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

export const urlOrUndefined = (value: unknown) => {
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

export const clientGrants = (client: Client) => client.grantTypes ?? DEFAULT_GRANT_TYPES;

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
export async function authenticateClient(form: URLSearchParams): Promise<Client> {
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

// Spec: knowledge/components/adyen-agentic-commerce.md
// The authorization code flow up to the shopper's consent, which also answers a device request.
import { get, put } from "../core/db";
import { trace } from "../core/trace";
import { newId, secret, sha256 } from "../core/util";
import {
  type AuthRequest,
  type Client,
  type Code,
  type Grant,
  isLoopback,
  issuer,
  limitOf,
  nowSec,
  OAuthError,
  requestedResources,
  requestedScopes,
} from "./shared";
import { resolveClient, urlOrUndefined } from "./clients";
import { pendingDevice } from "./device";

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

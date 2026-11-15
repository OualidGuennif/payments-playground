// Spec: knowledge/components/adyen-agentic-commerce.md
// PAP 1.0 on the merchant side: the discovery document and the Poppy-Session check.
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  type JWK,
  jwtVerify,
} from "jose";
import { config, PAP_VERSION } from "./config";
import { claimJti } from "./db";
import { type Auth, issuer, resolveClient, SCOPES, verifyWithClientKeys } from "./oauth";
import { isRecord, sha256b64url } from "./util";

export function poppyDocument() {
  const { publicOrigin, domain } = config();
  const scopes = Object.entries(SCOPES);
  return {
    protocol_version: PAP_VERSION,
    organization: { name: "Atelier Velune (demo)", domain },
    auth: {
      issuer: issuer(),
      scopes: scopes.map(([name]) => name),
      scope_hints: {
        changes: scopes.filter(([, s]) => s.kind === "changes").map(([name]) => name),
        personal_data: scopes.filter(([, s]) => s.kind === "personal_data").map(([name]) => name),
      },
    },
    apis: [
      {
        type: "mcp",
        url: `${publicOrigin}/mcp`,
        description:
          "UCP shopping tools: catalogue, carts, checkout with a saved-card payment, orders.",
      },
      {
        type: "openapi",
        url: `${publicOrigin}/ucp/v1/openapi.json`,
        description: "UCP 2026-08-25 REST binding of the same shopping service.",
      },
    ],
    extensions: { ucp: [{ version: "1" }] },
  };
}

export class PapError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type PapSession = { clientId: string; sid: string; sub: string };

const MAX_SKEW = 300;
const MAX_DELEGATION = 24 * 3600;

// Checks Poppy-Version and, when present, the Poppy-Session proof for this exact request.
export async function verifyPoppy(
  request: Request,
  publicUrl: string,
  auth: Auth | undefined,
): Promise<PapSession | undefined> {
  const version = request.headers.get("poppy-version");
  if (version !== null && version !== PAP_VERSION) {
    throw new PapError(
      "version_unsupported",
      `Poppy-Version ${version} is not supported; use ${PAP_VERSION}`,
      400,
    );
  }
  const jwt = request.headers.get("poppy-session");
  if (!jwt) return undefined;
  const invalid = (why: string) => new PapError("invalid_session", why, 400);

  let header, claims;
  try {
    header = decodeProtectedHeader(jwt);
    claims = decodeJwt(jwt);
  } catch {
    throw invalid("Poppy-Session is not a JWT");
  }
  if (header.typ !== "poppy-session+jwt" || header.alg !== "ES256")
    throw invalid("typ or alg not accepted");
  if (typeof claims.poppy_dlg !== "string") throw invalid("poppy_dlg is required");

  // The delegation binds the session key to the client: signed by a key from its jwks_uri.
  let dlgHeader, dlgClaims;
  try {
    dlgHeader = decodeProtectedHeader(claims.poppy_dlg);
    dlgClaims = decodeJwt(claims.poppy_dlg);
  } catch {
    throw invalid("poppy_dlg is not a JWT");
  }
  if (
    dlgHeader.typ !== "poppy-delegation+jwt" ||
    !["ES256", "PS384"].includes(String(dlgHeader.alg))
  ) {
    throw invalid("delegation typ or alg not accepted");
  }
  if (typeof dlgClaims.iss !== "string" || dlgClaims.iss !== claims.iss)
    throw invalid("delegation iss mismatch");
  let client;
  try {
    client = await resolveClient(dlgClaims.iss);
    await verifyWithClientKeys(client, claims.poppy_dlg, { typ: "poppy-delegation+jwt" });
  } catch (error) {
    // jose checks the signature before the claims, so an expiry here is a genuine, ended delegation.
    if ((error as { code?: string }).code === "ERR_JWT_EXPIRED")
      throw new PapError("session_ended", "The delegation expired", 400);
    throw invalid("delegation signature not verified with the client's keys");
  }
  const { iat: dIat, exp: dExp, jti: dJti } = dlgClaims;
  if (typeof dIat !== "number" || typeof dExp !== "number" || typeof dJti !== "string") {
    throw invalid("delegation iat, exp and jti are required");
  }
  if (dExp - dIat > MAX_DELEGATION) throw invalid("delegation lasts more than 24 hours");
  if (dExp < Math.floor(Date.now() / 1000))
    throw new PapError("session_ended", "The delegation expired", 400);
  const cnf =
    isRecord(dlgClaims.cnf) && isRecord(dlgClaims.cnf.jwk) ? (dlgClaims.cnf.jwk as JWK) : undefined;
  if (!cnf) throw invalid("delegation cnf.jwk is required");
  if (header.kid !== (await calculateJwkThumbprint(cnf)))
    throw invalid("kid is not the thumbprint of cnf.jwk");

  try {
    await jwtVerify(jwt, await importJWK(cnf, "ES256"), {
      typ: "poppy-session+jwt",
      algorithms: ["ES256"],
    });
  } catch {
    throw invalid("session signature does not match cnf.jwk");
  }
  const now = Math.floor(Date.now() / 1000);
  const { aud, sid, sub, htm, htu, iat, jti, ath } = claims;
  const audiences = Array.isArray(aud) ? aud : [aud];
  const resource = config().publicOrigin;
  if (!audiences.some((a) => a === resource || a === `${resource}/mcp`))
    throw invalid("aud is not this resource");
  if (typeof sid !== "string" || typeof sub !== "string") throw invalid("sid and sub are required");
  if (htm !== request.method) throw invalid("htm does not match the request method");
  const target = new URL(publicUrl);
  target.search = "";
  if (htu !== target.href) throw invalid("htu does not match the request URL");
  if (typeof iat !== "number" || Math.abs(now - iat) > MAX_SKEW) throw invalid("iat is not fresh");
  if (typeof jti !== "string" || !claimJti(`ps:${dlgClaims.iss}:${jti}`, now + MAX_SKEW))
    throw invalid("jti missing or replayed");
  if (auth) {
    if (ath !== sha256b64url(auth.accessToken))
      throw invalid("ath does not match the access token");
    if (auth.token.clientId !== dlgClaims.iss)
      throw invalid("the session belongs to another client");
  } else if (ath !== undefined) {
    throw invalid("ath sent without an access token");
  }
  return { clientId: dlgClaims.iss, sid, sub };
}

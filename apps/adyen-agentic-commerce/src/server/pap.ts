// Spec: knowledge/components/adyen-agentic-commerce.md
// PAP 1.0 on the merchant side: the discovery document and the Poppy-Session check.
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  type JWK,
  type JWTPayload,
  jwtVerify,
  type ProtectedHeaderParameters,
} from "jose";
import { config, PAP_VERSION } from "./config";
import { claimJti } from "./db";
import {
  ADVERTISED_SCOPES,
  type Auth,
  issuer,
  resolveClient,
  SCOPES,
  verifyWithClientKeys,
} from "./oauth";
import { isRecord, sha256b64url } from "./util";

export function poppyDocument() {
  const { publicOrigin, domain } = config();
  // PAP 1.0 §3.1 and §4.7: both maps are keyed by scope name, and every hint has both fields.
  // Legacy names stay out: they are honoured, not offered.
  return {
    protocol_version: PAP_VERSION,
    organization: { name: "Atelier Velune (demo)", domain },
    auth: {
      issuer: issuer(),
      scopes: Object.fromEntries(ADVERTISED_SCOPES.map((s) => [s, SCOPES[s].label])),
      scope_hints: Object.fromEntries(
        ADVERTISED_SCOPES.map((s) => [
          s,
          { changes: SCOPES[s].changes, personal_data: SCOPES[s].personalData },
        ]),
      ),
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

// PAP 1.0 §3.4: versions are major.minor, and from 1.0 the same major is compatible.
const COMPATIBLE_VERSION = new RegExp(`^${PAP_VERSION.split(".")[0]}\\.(0|[1-9][0-9]*)$`);

// Checks Poppy-Version and, when present, the Poppy-Session proof for this exact request.
export async function verifyPoppy(
  request: Request,
  publicUrl: string,
  auth: Auth | undefined,
): Promise<PapSession | undefined> {
  const version = request.headers.get("poppy-version");
  const jwt = request.headers.get("poppy-session");
  // A Session needs a version; a version sent without one must still be one this store serves.
  if ((jwt || version !== null) && !COMPATIBLE_VERSION.test(version ?? "")) {
    throw new PapError(
      "version_unsupported",
      version === null
        ? `Poppy-Version is required with Poppy-Session; use ${PAP_VERSION}`
        : `Poppy-Version ${version} is not supported; use ${PAP_VERSION}`,
      400,
    );
  }
  if (!jwt) return undefined;
  const invalid = (why: string) => new PapError("invalid_session", why, 400);

  let header: ProtectedHeaderParameters;
  let claims: JWTPayload;
  try {
    header = decodeProtectedHeader(jwt);
    claims = decodeJwt(jwt);
  } catch {
    throw invalid("Poppy-Session is not a JWT");
  }
  if (header.typ !== "poppy-session+jwt" || header.alg !== "ES256")
    throw invalid("typ or alg not accepted");
  // §5.2: the delegation rides in the protected header, never in the claims.
  const dlg = header.poppy_dlg;
  if (typeof dlg !== "string") throw invalid("poppy_dlg is required in the JWT header");

  // The delegation binds the session key to the client: signed by a key from its jwks_uri.
  let dlgHeader: ProtectedHeaderParameters;
  let dlgClaims: JWTPayload;
  try {
    dlgHeader = decodeProtectedHeader(dlg);
    dlgClaims = decodeJwt(dlg);
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
  let client: Awaited<ReturnType<typeof resolveClient>>;
  try {
    client = await resolveClient(dlgClaims.iss);
    await verifyWithClientKeys(client, dlg, { typ: "poppy-delegation+jwt" });
  } catch (error) {
    // §5.2: a delegation failing any check, expiry included, is invalid_session. jose checks the
    // signature before the claims, so this expiry is the client's own delegation running out.
    if ((error as { code?: string }).code === "ERR_JWT_EXPIRED")
      throw invalid("the delegation expired");
    throw invalid("delegation signature not verified with the client's keys");
  }
  const { iat: dIat, exp: dExp, jti: dJti } = dlgClaims;
  if (typeof dIat !== "number" || typeof dExp !== "number" || typeof dJti !== "string") {
    throw invalid("delegation iat, exp and jti are required");
  }
  if (dExp - dIat > MAX_DELEGATION) throw invalid("delegation lasts more than 24 hours");
  if (dExp < Math.floor(Date.now() / 1000)) throw invalid("the delegation expired");
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
  // §5.3 and §10.4: the Company's identifier (its issuer), one string, compared exactly.
  if (aud !== issuer()) throw invalid("aud must be the issuer, as a single string");
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

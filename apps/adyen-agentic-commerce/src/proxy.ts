// Spec: knowledge/components/adyen-agentic-commerce.md
// The shopper's own pages (sign-in, account, consent, device, Back Office) sit behind the playground's
// basic auth when it is configured; the agent-facing protocol paths never do, or no agent could
// reach them. Pages also carry the WebMCP origin-trial header when the owner set a token.
import { type NextRequest, NextResponse } from "next/server";
import { cleanEnvValue } from "./server/core/config";

const PROTECTED = [
  "/account",
  "/back-office",
  "/consent",
  "/device",
  "/sign-in",
  "/sign-up",
  "/api/account",
  "/api/back-office",
  "/api/customers",
  "/api/passkeys",
  "/api/session",
  "/oauth/decision",
  "/oauth/device/verify",
];

// The Pay email modal's check is a guest's way to Drop-in on a public checkout: it keeps the
// cross-site refusal and never asks for the playground's pair (docs/KNOWN_LIMITS.md).
const PUBLIC_FORMS = ["/api/session/check-email"];

// `docker run --env-file` keeps the quotes of `KEY="value"`; uncleaned, the right pair was refused.
export function basicAuthAllows(
  header: string | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const user = cleanEnvValue(env.PLAYGROUND_BASIC_AUTH_USER);
  const password = cleanEnvValue(env.PLAYGROUND_BASIC_AUTH_PASSWORD);
  if (!user || !password) return true;
  const match = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!match) return false;
  try {
    return atob(match[1]!) === `${user}:${password}`;
  } catch {
    // Malformed base64 is a failed sign-in, not a server error.
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a state-changing request on a shopper path came from another site. A browser attaches the
 * shopper's Basic Auth to a cross-site form POST, so without this a page the shopper opens could
 * approve an agent's consent or change a grant. Browsers say where a request came from in
 * Sec-Fetch-Site, or at least in Origin; a request with neither is not from a browser, carries
 * nothing the shopper's browser would add on its own, and still needs Basic Auth.
 */
export function crossSiteRefused(
  method: string,
  headers: Headers,
  ownOrigins: ReadonlyArray<string | undefined>,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";
  const origin = headers.get("origin");
  if (origin === null) return false;
  return !ownOrigins.some((own) => own !== undefined && own === origin);
}

function publicOrigin(): string | undefined {
  const value = cleanEnvValue(process.env.PUBLIC_ORIGIN);
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The owner's WebMCP origin-trial token, sent as an `Origin-Trial` header on pages. It is read per
 * request because pages are prerendered at build time, when the deploy's variables may be absent.
 * The token is public by design; anything that is not one is dropped, never sent.
 */
export function originTrialToken(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const token = cleanEnvValue(env.WEBMCP_ORIGIN_TRIAL_TOKEN);
  return token && token.length <= 4096 && /^[A-Za-z0-9+/]+={0,2}$/.test(token) ? token : undefined;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Where a page asked under another name of this service belongs: the same path on the public
 * origin. The session cookie holds only on the host that set it and passkeys are bound to the
 * public origin's host, while every agent link (approval page, Show details, continue_url) names
 * that origin, so a shopper signed in under Render's own name looked signed out there and could not
 * use a passkey. Only pages move, only for an https public origin; a loopback run never leaves the
 * machine, and the API and agent paths answer under any name.
 */
export function canonicalUrl(
  method: string,
  url: { pathname: string; search: string },
  host: string | null,
  origin: string | undefined,
): string | undefined {
  if (!origin || !host || (method !== "GET" && method !== "HEAD")) return undefined;
  const own = new URL(origin);
  const asked = host.trim().toLowerCase();
  if (own.protocol !== "https:" || asked === own.host || LOOPBACK.test(asked)) return undefined;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth/")) return undefined;
  return `${own.origin}${url.pathname}${url.search}`;
}

function pass(): NextResponse {
  const response = NextResponse.next();
  const token = originTrialToken();
  if (token) response.headers.set("origin-trial", token);
  return response;
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = request.headers.get("host");
  const moved = canonicalUrl(request.method, request.nextUrl, host, publicOrigin());
  if (moved) return NextResponse.redirect(moved, 308);
  if (!PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) return pass();
  if (crossSiteRefused(request.method, request.headers, [request.nextUrl.origin, publicOrigin()])) {
    return new NextResponse("Cross-site request refused", { status: 403 });
  }
  if (PUBLIC_FORMS.includes(path) || basicAuthAllows(request.headers.get("authorization")))
    return pass();
  return new NextResponse("Sign-in required", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Atelier Velune shopper", charset="UTF-8"' },
  });
}

export const config = {
  matcher: [
    // Pages, for the origin-trial header; the agent protocol paths and assets never pass here.
    "/((?!api/|_next/|mcp|ucp/|oauth/|poppy/|\\.well-known/|healthz|favicon).*)",
    "/account/:path*",
    "/back-office/:path*",
    "/consent/:path*",
    "/device",
    "/api/account/:path*",
    "/api/back-office",
    "/api/customers",
    "/api/passkeys/:path*",
    "/api/session",
    "/api/session/:path*",
    "/oauth/decision",
    "/oauth/device/verify",
  ],
};

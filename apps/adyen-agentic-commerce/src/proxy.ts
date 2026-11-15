// Spec: knowledge/components/adyen-agentic-commerce.md
// The shopper's own pages (account, consent, Back Office) sit behind the playground's basic auth when
// it is configured; the agent-facing protocol paths never do, or no agent could reach them.
import { type NextRequest, NextResponse } from "next/server";
import { cleanEnvValue } from "./server/config";

const PROTECTED = [
  "/account",
  "/back-office",
  "/consent",
  "/api/account",
  "/api/back-office",
  "/oauth/decision",
];

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

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  if (crossSiteRefused(request.method, request.headers, [request.nextUrl.origin, publicOrigin()])) {
    return new NextResponse("Cross-site request refused", { status: 403 });
  }
  if (basicAuthAllows(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Sign-in required", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Atelier Velune shopper", charset="UTF-8"' },
  });
}

export const config = {
  matcher: [
    "/account/:path*",
    "/back-office/:path*",
    "/consent/:path*",
    "/api/account/:path*",
    "/api/back-office",
    "/oauth/decision",
  ],
};

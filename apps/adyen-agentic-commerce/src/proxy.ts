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

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
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

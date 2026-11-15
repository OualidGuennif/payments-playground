// Spec: knowledge/components/adyen-digital.md
// Optional Basic Auth for the pages and static files; the API and the webhook answer their own
// challenge in serveSecurely. A page response also carries the CSRF cookie: a flow page starts its
// checkout on load, and that first POST needs the token before any API call set it. Nothing here
// reads the configuration: Next copies every file the proxy's imports touch (the env file and the
// database among them) into the standalone build, and its tracing excludes skip the proxy.
import { type NextRequest, NextResponse } from "next/server";
import { basicAuthChallenge, CookieJar, ensureCsrfToken } from "@suite/platform/security.ts";

export function proxy(request: NextRequest) {
  const challenge = basicAuthChallenge(request);
  if (challenge) return challenge;
  const response = NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/_next/")) return response;
  const jar = new CookieJar(request);
  ensureCsrfToken(request, jar);
  for (const cookie of jar.issued) response.headers.append("Set-Cookie", cookie);
  return response;
}

export const config = {
  matcher: ["/((?!api/|healthz|webhook).*)"],
};

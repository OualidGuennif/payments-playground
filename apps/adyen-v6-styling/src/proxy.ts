// Spec: knowledge/components/adyen-v6-styling.md
// Optional Basic Auth for the pages and static files; the API answers its own challenge in
// serveSecurely, and both use the same check, which leaves the health routes open.
import { type NextRequest, NextResponse } from "next/server";
import { basicAuthChallenge } from "@suite/platform/security.ts";

export function proxy(request: NextRequest) {
  return basicAuthChallenge(request) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|healthz).*)"],
};

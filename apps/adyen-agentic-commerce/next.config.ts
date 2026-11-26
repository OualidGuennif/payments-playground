// Spec: knowledge/components/adyen-agentic-commerce.md
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The headers the other playgrounds send (packages/platform SECURITY_HEADERS; ADR-005: no CSP),
// except the microphone below.
// The consent page holds the Allow button, so it must never render inside another site's frame.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The Ask panel's voice mode asks for the microphone on the store's own pages only.
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

// The workspace root: the one root bun.lock and the hoisted node_modules live there.
const root = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  // The Docker image runs the self-contained server, not the whole node_modules tree.
  output: "standalone",
  outputFileTracingRoot: root,
  // The database path is built from process.cwd(), which makes the tracer copy the local data
  // folder; TEST orders and env files never belong in a build output (ADR-009).
  outputFileTracingExcludes: { "*": ["**/data/**", "**/*.sqlite*", "**/.env*"] },
  turbopack: { root },
  // Local PUBLIC_ORIGIN is 127.0.0.1, which Next's dev server otherwise treats as cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  // Next 16.4 otherwise writes an AGENTS.md here; agent instructions live at the repository root.
  agentRules: false,
  serverExternalPackages: ["@adyen/api-library"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
    ];
  },
};

export default config;

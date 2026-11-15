// Spec: knowledge/components/adyen-v6-styling.md
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "@suite/platform/security.ts";

// The workspace root: the shared packages and the one hoisted node_modules live there.
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
  // Off, as the Preact islands effectively were: Strict Mode runs each mount effect twice in dev,
  // and these effects call Adyen (a /sessions order, a single-use redirectResult) more than once.
  reactStrictMode: false,
  // Next 16.4 otherwise writes an AGENTS.md here; agent instructions live at the repository root.
  agentRules: false,
  transpilePackages: ["@suite/platform", "@suite/ui"],
  serverExternalPackages: ["@adyen/api-library"],
  // The pages get the same headers the API answers with (ADR-005: no CSP).
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

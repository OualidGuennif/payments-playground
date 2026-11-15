// Spec: knowledge/components/adyen-agentic-commerce.md
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

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
};

export default config;

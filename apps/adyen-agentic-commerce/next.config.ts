import type { NextConfig } from "next";

const config: NextConfig = {
  // The Docker image runs the self-contained server, not the whole node_modules tree.
  output: "standalone",
  // Local PUBLIC_ORIGIN is 127.0.0.1, which Next's dev server otherwise treats as cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  serverExternalPackages: ["@adyen/api-library"],
};

export default config;

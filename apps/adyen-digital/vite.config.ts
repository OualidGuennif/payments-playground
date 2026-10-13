import { fresh } from "@fresh/plugin-vite";
import { defineConfig } from "vite";
import { adyenLibraryExternal } from "../../scripts/adyen-library-external.ts";
import { adyenWebDevBundle } from "../../scripts/adyen-web-dev-bundle.ts";
import { devClientAddress } from "../../scripts/dev-client-address.ts";
import { sqliteViteHotfix } from "../../scripts/sqlite-vite-hotfix.ts";

export default defineConfig({
  plugins: [
    devClientAddress(),
    fresh(),
    sqliteViteHotfix(),
    adyenLibraryExternal(),
    adyenWebDevBundle(),
  ],
  // Only the dev server reads this; the build needs the plugin above.
  ssr: { external: ["@adyen/api-library"] },
  // No root package.json (Deno workspace), so Vite's default workspace-root
  // detection can't find the monorepo's node_modules, registering more
  // Adyen Web components deepens the import graph enough that some chunks
  // fall outside the default fs allowlist and silently 403 in dev, breaking
  // Drop-in. Explicitly allow the monorepo root.
  // A production build (deno task check, build:digital) rewrites _fresh/;
  // watched, that reloaded every open dev page several times per build, and
  // each Sessions reload created an empty order.
  server: { fs: { allow: ["../.."] }, watch: { ignored: ["**/_fresh/**"] } },
});

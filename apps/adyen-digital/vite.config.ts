// Spec: knowledge/components/adyen-digital.md
import { fresh } from "@fresh/plugin-vite";
import { defineConfig } from "vite";
import { adyenLibraryExternal } from "../../tools/dev/adyen-library-external.ts";
import { adyenWebDevBundle } from "../../tools/dev/adyen-web-dev-bundle.ts";
import { devClientAddress } from "../../tools/dev/dev-client-address.ts";
import { sqliteViteHotfix } from "../../tools/dev/sqlite-vite-hotfix.ts";

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
  // @fresh/plugin-vite 1.1.2 sends a full page reload for any watched file
  // that changes outside an island's imports. The SQLite database (and its
  // -wal, -shm and .profile-key files) changes on every API call and
  // callback, so a page reloaded while the shopper was typing.
  server: { fs: { allow: ["../.."] }, watch: { ignored: ["**/_fresh/**", "**/*.sqlite*"] } },
});

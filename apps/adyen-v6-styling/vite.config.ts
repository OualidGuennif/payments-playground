import { fresh } from "@fresh/plugin-vite";
import { defineConfig } from "vite";
import { adyenLibraryExternal } from "../../scripts/adyen-library-external.ts";
import { adyenWebDevBundle } from "../../scripts/adyen-web-dev-bundle.ts";
import { sqliteViteHotfix } from "../../scripts/sqlite-vite-hotfix.ts";

export default defineConfig({
  plugins: [fresh(), sqliteViteHotfix(), adyenLibraryExternal(), adyenWebDevBundle()],
  // Only the dev server reads this; the build needs the plugin above.
  ssr: { external: ["@adyen/api-library"] },
  // No root package.json (Deno workspace), so Vite's default workspace-root
  // detection can't find the monorepo's node_modules, explicitly allow it.
  // A production build (deno task check, build:styling) rewrites _fresh/;
  // watched, that reloaded every open dev page during each build.
  // @fresh/plugin-vite 1.1.2 sends a full page reload for any watched file
  // that changes outside an island's imports. The SQLite database (and its
  // -wal, -shm and .profile-key files) changes on every API call and
  // callback, so a page reloaded while the shopper was typing.
  server: { fs: { allow: ["../.."] }, watch: { ignored: ["**/_fresh/**", "**/*.sqlite*"] } },
});

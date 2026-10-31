import type { Plugin } from "vite";

const SQLITE_FFI_PATH = "@db/sqlite/0.13.0/src/ffi.ts";
const SQLITE_FFI_URL = `https://jsr.io/${SQLITE_FFI_PATH}`;

/**
 * Deno's Vite bridge rewrites the remote SQLite FFI module before Vite's SSR
 * transform. Vite then tries to edit `import.meta.url` inside the same already
 * edited chunk and throws. The value is the module URL, so replacing that exact
 * expression with its URL literal preserves SQLite's native-library lookup.
 */
export function sqliteViteHotfix(): Plugin {
  return {
    name: "adyen-suite:sqlite-import-meta-hotfix",
    enforce: "post",
    transform(code, id) {
      if (!id.includes(SQLITE_FFI_PATH) || !code.includes("import.meta.url")) return null;
      return code.replaceAll("import.meta.url", JSON.stringify(SQLITE_FFI_URL));
    },
  };
}

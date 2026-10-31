import type { Plugin } from "vite";

const LIBRARY = "@adyen/api-library";

/**
 * `ssr.external` is only read by Vite's own resolver, and Fresh's Deno plugin
 * declares `enforce: "pre"` precisely to take that resolver's place. So during
 * `vite build` the Adyen library is resolved through Deno's loader and bundled
 * like everything else, which drags its CommonJS transport chain
 * (`https-proxy-agent` then `debug`) through the CJS-to-ESM conversion. That
 * conversion loses `debug`'s callable default export, and the built server dies
 * on import, before serving a single request, with
 * `TypeError: debug_1.default is not a function`.
 *
 * An external result returned by another plugin is the one form the Deno plugin
 * forwards untouched, so the bare specifier survives in the bundle and Deno
 * loads the package as CommonJS at runtime. That is the shape
 * `packages/platform/adyen.ts` already imports it in, and the one its tests
 * exercise outside Vite entirely.
 */
export function adyenLibraryExternal(): Plugin {
  return {
    name: "adyen-suite:adyen-library-external",
    enforce: "pre",
    apply: "build",
    applyToEnvironment(environment) {
      return environment.config.consumer === "server";
    },
    resolveId(id) {
      return id === LIBRARY || id.startsWith(`${LIBRARY}/`) ? { id, external: true } : null;
    },
  };
}

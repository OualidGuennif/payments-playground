import { build } from "esbuild";
import type { Plugin } from "vite";

const PACKAGE = "@adyen/adyen-web";
const BUNDLE_ID = "\0adyen-web-dev-bundle";

/**
 * Fresh turns Vite's dependency optimizer off (`optimizeDeps.noDiscovery`),
 * so in dev Adyen Web reaches the browser as its ~620 source modules, each at
 * its real path. Four of those paths are `core/Analytics/*.js`, and Adblock
 * Plus, uBlock Origin and Firefox's tracking protection all block URLs like
 * that: one blocked module fails the whole import graph and Drop-in never
 * mounts. A production build is unaffected, Adyen Web is bundled into a hashed
 * island chunk there.
 *
 * Re-enabling the optimizer for this one package is not an option either: it
 * appends `?v=` hashes to every node_modules import, which the Deno loader
 * cannot open. So this serves the package in dev as one esbuild bundle, the
 * same single file a build produces. The package vendors its own Preact under
 * `dist/es/external/`, so the bundle is self-contained and shares nothing with
 * the app, exactly as in the build.
 *
 * `enforce: "pre"` matters: the Deno plugin resolves through every other
 * plugin first, and Vite's own resolver answers a bare package name before
 * any normal plugin is asked. A `\0` id is the form the Deno plugin passes on
 * untouched.
 */
export function adyenWebDevBundle(): Plugin {
  let bundle: Promise<string> | undefined;
  let root = "";
  return {
    name: "adyen-suite:adyen-web-dev-bundle",
    enforce: "pre",
    apply: "serve",
    applyToEnvironment(environment) {
      return environment.config.consumer === "client";
    },
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === PACKAGE ? BUNDLE_ID : null;
    },
    load(id) {
      if (id !== BUNDLE_ID) return null;
      bundle ??= bundleAdyenWeb(root);
      return bundle;
    },
  };
}

async function bundleAdyenWeb(resolveDir: string): Promise<string> {
  const result = await build({
    stdin: { contents: `export * from "${PACKAGE}";`, resolveDir, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

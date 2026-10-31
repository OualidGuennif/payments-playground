import { build } from "esbuild";
import type { Plugin } from "vite";

const PACKAGE = "@adyen/adyen-web";
const BUNDLE_ID = "\0adyen-web-dev-bundle";

/**
 * Fresh disables Vite's dependency optimizer, so Adyen Web reaches the dev
 * browser as ~620 source modules; ad blockers refuse `core/Analytics/*.js`
 * and Drop-in never mounts. The optimizer would add `?v=` imports the Deno
 * loader cannot open, so serve the package as one esbuild bundle, as a build
 * does. `enforce: "pre"` and the `\0` id keep Vite's own resolver from
 * answering the bare package first.
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

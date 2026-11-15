// Runs a Bun app's package script with its .env parsed by @std/dotenv, the parser every Deno app
// here uses and the one tools/dev/migrate-legacy-env.ts writes for. Next's own loader re-expands
// `$name` inside values the process already holds, which cut an Adyen TEST key and gave 401s.
// Spec: knowledge/operations/build-and-test.md
import { parse } from "@std/dotenv";
import { join, resolve } from "@std/path";

const [directory, script, ...rest] = Deno.args;
if (!directory || !script) {
  throw new Error("Usage: bun-app.ts <app directory> <package script> [args]");
}
const cwd = resolve(directory);

function fileValues(path: string): Record<string, string> {
  try {
    const text = Deno.readTextFileSync(path);
    return parse(text.split("\n").map((line) => line.replace(/^\s*export\s+/, "")).join("\n"));
  } catch {
    return {};
  }
}

// The shell and the host (Render, Docker) win over the file, as with the Deno apps.
// __NEXT_PROCESSED_ENV is Next's own "already loaded" mark: it then leaves these values as they are.
const env = {
  ...fileValues(join(cwd, ".env")),
  ...Deno.env.toObject(),
  __NEXT_PROCESSED_ENV: "true",
};
const child = new Deno.Command("bun", {
  args: ["run", script, ...rest],
  cwd,
  env,
  clearEnv: true,
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    try {
      child.kill(signal);
    } catch {
      // Already stopped.
    }
  });
}
Deno.exit((await child.status).code);

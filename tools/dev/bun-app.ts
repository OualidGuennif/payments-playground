// Runs an app's package script with its .env parsed by the platform's dotenv reader, which never
// expands `$name`. Next's own loader re-expands `$name` inside values the process already holds,
// which cut an Adyen TEST key and gave 401s; __NEXT_PROCESSED_ENV tells it the work is done.
// Spec: knowledge/operations/build-and-test.md
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDotenv } from "../../packages/platform/dotenv.ts";

const [directory, script, ...rest] = process.argv.slice(2);
if (!directory || !script) {
  throw new Error("Usage: bun tools/dev/bun-app.ts <app directory> <package script> [args]");
}
const cwd = resolve(directory);

function fileValues(path: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

// The shell and the host (Render, Docker) win over the file.
const env: Record<string, string | undefined> = {
  ...fileValues(join(cwd, ".env")),
  ...process.env,
  __NEXT_PROCESSED_ENV: "true",
};
const child = Bun.spawn(["bun", "run", script, ...rest], {
  cwd,
  env,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    try {
      child.kill(signal);
    } catch {
      // Already stopped.
    }
  });
}
process.exit(await child.exited);

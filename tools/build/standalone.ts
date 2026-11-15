// Spec: knowledge/operations/build-and-test.md
// Starts an app's standalone Next.js server, the file its Docker image runs, for the build checks.
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

export interface Standalone {
  origin: string;
  stop(): Promise<void>;
}

export async function startStandalone(
  appDirectory: string,
  port: number,
  env: Record<string, string> = {},
): Promise<Standalone> {
  // Every app traces from the repository root, so its server sits at the app's own relative path.
  const app = relative(repositoryRoot, resolve(appDirectory));
  const server = join(repositoryRoot, app, ".next/standalone", app, "server.js");
  if (!existsSync(server)) throw new Error(`${server} is missing; build ${app} first.`);
  const child = Bun.spawn(["bun", server], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      // Next must not load an env file of its own: it would expand `$name` inside values.
      __NEXT_PROCESSED_ENV: "true",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      ...env,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const origin = `http://127.0.0.1:${port}`;
  const stop = async () => {
    child.kill("SIGTERM");
    await child.exited;
  };
  let lastError = "the server did not answer";
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`${app}: the server exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1_000) });
      const body = await response.json() as { status?: string };
      if (response.ok && body.status === "ok") return { origin, stop };
      lastError = `${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  await stop();
  throw new Error(`${app} health check failed: ${lastError}`);
}

/** Fetches a page as a browser would and names every way it is not a rendered TEST page. */
export async function pageFailures(url: string, expectedText?: string): Promise<string[]> {
  const response = await fetch(url, { headers: { Accept: "text/html" } });
  const html = await response.text();
  return [
    response.status !== 200 ? `expected status 200, got ${response.status}` : "",
    !html.includes("<main") ? "no <main> element in the rendered HTML" : "",
    !html.includes("TEST") ? "the TEST marker is missing" : "",
    html.includes("Internal Server Error") ? "the page rendered an internal error" : "",
    // The usual cause: an app was renamed and the caller still names the old title.
    expectedText && !html.includes(expectedText)
      ? `the page never contains ${JSON.stringify(expectedText)}`
      : "",
  ].filter(Boolean);
}

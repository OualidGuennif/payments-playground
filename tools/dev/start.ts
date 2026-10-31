const port = Number(Deno.env.get("PORT") || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

// `deno serve` understands Fresh's generated default export and registration
// hooks. Spawning it also keeps PORT dynamic for Render and Docker without
// relying on shell-specific ${PORT:-8000} expansion.
const server = new Deno.Command(Deno.execPath(), {
  args: [
    "serve",
    "-A",
    `--port=${port}`,
    "--host=0.0.0.0",
    "_fresh/server.js",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

const interrupted = new Promise<void>((resolve) => {
  Deno.addSignalListener("SIGINT", () => resolve());
  Deno.addSignalListener("SIGTERM", () => resolve());
});

try {
  const outcome = await Promise.race([
    server.status.then((status) => ({ kind: "exit" as const, status })),
    interrupted.then(() => ({ kind: "signal" as const })),
  ]);
  if (outcome.kind === "exit" && !outcome.status.success) {
    throw new Error(`Fresh server exited with code ${outcome.status.code}.`);
  }
} finally {
  try {
    server.kill("SIGTERM");
  } catch {
    // Already stopped.
  }
  await server.status;
}

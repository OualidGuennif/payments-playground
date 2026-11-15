const basePort = Number(Deno.env.get("BASE_PORT") || 8001);
// Offsets keep each app on its documented port (8001, 8003, 8004); 8002 was the removed IPP app.
const directories = [
  ["apps/adyen-digital", 0],
  ["apps/adyen-agentic-commerce", 2],
  ["apps/adyen-v6-styling", 3],
] as const;

const children = directories.map(([directory, offset]) => {
  const port = basePort + offset;
  const bun = directory === "apps/adyen-agentic-commerce";
  return new Deno.Command(Deno.execPath(), {
    args: bun
      ? ["run", "-A", "tools/dev/bun-app.ts", directory, "start"]
      : ["run", "-A", "../../tools/dev/start.ts"],
    cwd: bun ? "." : directory,
    env: {
      ...Deno.env.toObject(),
      PORT: String(port),
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
});

const interrupted = new Promise<void>((resolve) => {
  Deno.addSignalListener("SIGINT", () => resolve());
  Deno.addSignalListener("SIGTERM", () => resolve());
});

try {
  await Promise.race([
    interrupted,
    ...children.map(async (child) => {
      const status = await child.status;
      if (!status.success) throw new Error(`A playground server exited with code ${status.code}.`);
    }),
  ]);
} finally {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already stopped.
    }
  }
  await Promise.allSettled(children.map((child) => child.status));
}

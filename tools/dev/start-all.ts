const basePort = Number(Deno.env.get("BASE_PORT") || 8001);
const directories = [
  "apps/adyen-digital",
  "apps/adyen-ipp-endless-aisle",
  "apps/adyen-agentic-commerce",
  "apps/adyen-v6-styling",
];

const children = directories.map((directory, index) => {
  const port = basePort + index;
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "../../tools/dev/start.ts"],
    cwd: directory,
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

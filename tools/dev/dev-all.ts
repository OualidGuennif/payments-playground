const basePort = Number(Deno.env.get("BASE_PORT") || 8001);
if (!Number.isInteger(basePort) || basePort < 1 || basePort + 3 > 65_535) {
  throw new Error("BASE_PORT must leave room for four valid consecutive ports.");
}

const applications = [
  ["Digital", "apps/adyen-digital"],
  ["IPP Endless Aisle", "apps/adyen-ipp-endless-aisle"],
  ["Agentic Commerce", "apps/adyen-agentic-commerce"],
  ["V6 Styling", "apps/adyen-v6-styling"],
] as const;

const children = applications.map(([name, directory], index) => {
  const port = basePort + index;
  console.log(`${name}: http://127.0.0.1:${port}`);
  // The agentic store is a Bun project: Next's dev server, reading PORT, through the env wrapper.
  const bun = directory === "apps/adyen-agentic-commerce";
  return new Deno.Command(Deno.execPath(), {
    args: bun
      ? ["run", "-A", "tools/dev/bun-app.ts", directory, "dev"]
      : ["run", "-A", "npm:vite@7.1.4", "--host", "0.0.0.0", "--port", String(port)],
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
      throw new Error(`A playground dev server exited with code ${status.code}.`);
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

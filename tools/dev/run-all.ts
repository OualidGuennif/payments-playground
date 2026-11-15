// Spec: knowledge/operations/build-and-test.md
// Runs one package script (`dev` or `start`) in every playground at once, each on its documented
// port and through bun-app.ts so its .env is read without `$` expansion. One exit stops them all.
import process from "node:process";

const script = process.argv[2];
if (script !== "dev" && script !== "start") {
  throw new Error("Usage: bun tools/dev/run-all.ts <dev|start>");
}

const basePort = Number(process.env.BASE_PORT || 8001);
if (!Number.isInteger(basePort) || basePort < 1 || basePort + 3 > 65_535) {
  throw new Error("BASE_PORT must leave room for four valid consecutive ports.");
}

// Offsets keep each app on its documented port (8001, 8003, 8004); 8002 was the removed IPP app.
const applications = [
  ["Digital", "apps/adyen-digital", 0],
  ["Agentic Commerce", "apps/adyen-agentic-commerce", 2],
  ["V6 Styling", "apps/adyen-v6-styling", 3],
] as const;

const children = applications.map(([name, directory, offset]) => {
  const port = String(basePort + offset);
  console.log(`${name}: http://127.0.0.1:${port}`);
  return Bun.spawn(["bun", "tools/dev/bun-app.ts", directory, script, "--port", port], {
    // The shell wins over each .env, so PUBLIC_ORIGIN follows the port actually used.
    env: { ...process.env, PORT: port, PUBLIC_ORIGIN: `http://127.0.0.1:${port}` },
    stdout: "inherit",
    stderr: "inherit",
  });
});

const interrupted = new Promise<void>((resolve) => {
  process.on("SIGINT", () => resolve());
  process.on("SIGTERM", () => resolve());
});

try {
  await Promise.race([
    interrupted,
    ...children.map(async (child) => {
      const code = await child.exited;
      throw new Error(`A playground server exited with code ${code}.`);
    }),
  ]);
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.allSettled(children.map((child) => child.exited));
}

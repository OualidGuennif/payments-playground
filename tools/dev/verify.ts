interface Target {
  name: string;
  directory: string;
  port: number;
  pages: string[];
}

const targets: Target[] = [
  {
    name: "adyen-digital",
    directory: "apps/adyen-digital",
    port: 8101,
    pages: ["/", "/sessions", "/advanced", "/pay-by-link", "/back-office", "/settings", "/wiki"],
  },
  {
    name: "ipp-endless-aisle",
    directory: "apps/adyen-ipp-endless-aisle",
    port: 8102,
    pages: ["/", "/back-office", "/history", "/settings", "/wiki"],
  },
  {
    name: "adyen-agentic-commerce",
    directory: "apps/adyen-agentic-commerce",
    port: 8103,
    pages: ["/", "/back-office", "/history", "/settings", "/wiki"],
  },
  {
    name: "adyen-v6-styling",
    directory: "apps/adyen-v6-styling",
    port: 8104,
    pages: ["/"],
  },
];

const temporaryData = await Deno.makeTempDir({ prefix: "adyen-suite-verify-" });
const children: Deno.ChildProcess[] = [];

async function waitForHealth(target: Target): Promise<void> {
  const url = `http://127.0.0.1:${target.port}/healthz`;
  let lastError = "server did not answer";
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.json();
      if (response.ok && body.status === "ok") return;
      lastError = `${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${target.name} health check failed: ${lastError}`);
}

async function verifyPages(target: Target): Promise<void> {
  for (const path of target.pages) {
    const response = await fetch(`http://127.0.0.1:${target.port}${path}`, {
      headers: { Accept: "text/html" },
    });
    const html = await response.text();
    if (!response.ok) {
      throw new Error(`${target.name}${path} returned ${response.status}.`);
    }
    if (!html.includes("TEST") || !html.includes("<main")) {
      throw new Error(
        `${target.name}${path} is missing the TEST marker or main landmark: ${
          JSON.stringify(html.slice(0, 240))
        }`,
      );
    }
    if (html.includes("Internal Server Error")) {
      throw new Error(`${target.name}${path} rendered an internal error.`);
    }
  }
}

try {
  for (const target of targets) {
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "../../tools/dev/start.ts"],
      cwd: target.directory,
      env: {
        ...Deno.env.toObject(),
        PORT: String(target.port),
        PUBLIC_ORIGIN: `http://127.0.0.1:${target.port}`,
        DATABASE_PATH: `${temporaryData}/${target.name}.sqlite`,
      },
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    children.push(child);
  }

  await Promise.all(targets.map(waitForHealth));
  await Promise.all(targets.map(verifyPages));
  for (const target of targets) {
    console.log(
      `✓ ${target.name}: /healthz + ${target.pages.length} rendered page(s)`,
    );
  }
} finally {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The server may already have exited.
    }
  }
  await Promise.allSettled(children.map((child) => child.status));
  await Deno.remove(temporaryData, { recursive: true });
}

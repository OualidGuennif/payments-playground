// Spec: knowledge/operations/build-and-test.md
// Starts every built playground from its standalone output, on its own temporary database, and
// checks /healthz and that each listed page renders as a TEST page.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageFailures, type Standalone, startStandalone } from "../build/standalone.ts";

const targets = [
  {
    name: "adyen-digital",
    directory: "apps/adyen-digital",
    port: 8101,
    pages: ["/", "/sessions", "/advanced", "/pay-by-link", "/back-office", "/settings", "/wiki"],
  },
  {
    name: "adyen-agentic-commerce",
    directory: "apps/adyen-agentic-commerce",
    port: 8103,
    pages: ["/", "/shop", "/agents", "/account", "/back-office", "/legal"],
  },
  {
    name: "adyen-v6-styling",
    directory: "apps/adyen-v6-styling",
    port: 8104,
    pages: ["/"],
  },
];

const temporaryData = mkdtempSync(join(tmpdir(), "adyen-suite-verify-"));
const servers: Standalone[] = [];

try {
  servers.push(
    ...await Promise.all(targets.map((target) =>
      startStandalone(target.directory, target.port, {
        PUBLIC_ORIGIN: `http://127.0.0.1:${target.port}`,
        DATABASE_PATH: join(temporaryData, `${target.name}.sqlite`),
      })
    )),
  );
  for (const [index, target] of targets.entries()) {
    for (const path of target.pages) {
      const failures = await pageFailures(`${servers[index].origin}${path}`);
      if (failures.length > 0) throw new Error(`${target.name}${path}: ${failures.join("; ")}`);
    }
    console.log(`✓ ${target.name}: /healthz + ${target.pages.length} rendered page(s)`);
  }
} finally {
  await Promise.allSettled(servers.map((server) => server.stop()));
  rmSync(temporaryData, { recursive: true, force: true });
}

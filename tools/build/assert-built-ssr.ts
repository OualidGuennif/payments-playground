// Spec: knowledge/operations/build-and-test.md
// Boots one app's standalone server and checks that its home page renders on the server: status
// 200, a <main>, the TEST marker and the app's title. Docker images run it right after the build.
import { pageFailures, startStandalone } from "./standalone.ts";

const [appDirectory, expectedText, portArgument] = process.argv.slice(2);
if (!appDirectory || !expectedText) {
  throw new Error(
    "Usage: bun tools/build/assert-built-ssr.ts <app-directory> <expected-text> [port]",
  );
}

// Build-time checks never touch persistent application storage.
const server = await startStandalone(appDirectory, Number(portArgument || 8199), {
  DATABASE_PATH: ":memory:",
});
try {
  const failures = await pageFailures(`${server.origin}/`, expectedText);
  if (failures.length > 0) {
    throw new Error(`Invalid SSR output for ${appDirectory}:\n  - ${failures.join("\n  - ")}`);
  }
  console.log(`SSR assertion passed for ${appDirectory}.`);
} finally {
  await server.stop();
}

const [appDirectory, expectedText] = Deno.args;

if (!appDirectory || !expectedText) {
  throw new Error(
    "Usage: assert-built-ssr.ts <app-directory> <expected-text>",
  );
}

// Keep build-time checks isolated from persistent application storage.
Deno.env.set("DATABASE_PATH", ":memory:");

const entrypoint = new URL(
  `../../${appDirectory}/_fresh/server.js`,
  import.meta.url,
);
const server = (await import(entrypoint.href)).default as {
  fetch(request: Request): Response | Promise<Response>;
};

const response = await server.fetch(
  new Request("http://localhost/", {
    headers: { accept: "text/html" },
  }),
);
const html = await response.text();

const failures = [
  response.status !== 200 ? `expected status 200, got ${response.status}` : "",
  !html.includes("<main") ? "no <main> element in the rendered HTML" : "",
  !html.includes("TEST") ? "the TEST marker is missing" : "",
  // The usual cause: an app was renamed and this argument still names the old
  // title. Say so, rather than reporting a byte count that looks healthy.
  !html.includes(expectedText) ? `the page never contains ${JSON.stringify(expectedText)}` : "",
].filter(Boolean);

if (failures.length > 0) {
  throw new Error(
    `Invalid SSR output for ${appDirectory} (${html.length} bytes):\n  - ${
      failures.join("\n  - ")
    }`,
  );
}

console.log(
  `SSR assertion passed for ${appDirectory} (${html.length} bytes).`,
);

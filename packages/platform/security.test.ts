import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { csrfProtection, requestOrigin } from "./security.ts";

const PUBLIC_ORIGIN = "http://127.0.0.1:8001";

function request(url: string, origin?: string): Request {
  return new Request(url, { method: "POST", headers: origin ? { origin } : {} });
}

Deno.test("requestOrigin follows the browser when it is on the app's own host", () => {
  // `deno task dev` serves on Vite's port while .env still names dev:digital's.
  assertEquals(
    requestOrigin(request("http://localhost:5173/api/x", "http://localhost:5173"), PUBLIC_ORIGIN),
    "http://localhost:5173",
  );
  assertEquals(
    requestOrigin(request("http://127.0.0.1:8001/api/x", "http://localhost:8001"), PUBLIC_ORIGIN),
    "http://localhost:8001",
  );
});

Deno.test("requestOrigin falls back to PUBLIC_ORIGIN for a foreign or missing Origin", () => {
  assertEquals(
    requestOrigin(request("http://localhost:5173/api/x", "https://evil.example"), PUBLIC_ORIGIN),
    PUBLIC_ORIGIN,
  );
  assertEquals(requestOrigin(request("http://localhost:5173/api/x"), PUBLIC_ORIGIN), PUBLIC_ORIGIN);
  assertEquals(
    requestOrigin(request("http://localhost:5173/api/x", "null"), PUBLIC_ORIGIN),
    PUBLIC_ORIGIN,
  );
});

Deno.test("CSRF still rejects a cross-origin POST that carries a valid token", async () => {
  const app = new Hono();
  app.use("*", csrfProtection("test-secret", PUBLIC_ORIGIN));
  app.post("/api/x", (c) => c.json({ ok: true }));
  const headers = { cookie: "adyen_csrf=token", "x-csrf-token": "token" };

  const sameOrigin = await app.request("http://localhost:5173/api/x", {
    method: "POST",
    headers: { ...headers, origin: "http://localhost:5173" },
  });
  assertEquals(sameOrigin.status, 200);

  const crossOrigin = await app.request("http://localhost:5173/api/x", {
    method: "POST",
    headers: { ...headers, origin: "https://evil.example" },
  });
  assertEquals(crossOrigin.status, 403);
});

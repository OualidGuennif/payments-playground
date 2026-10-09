import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { basicAuthChallenge, csrfProtection, requestOrigin } from "./security.ts";

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

Deno.test("Basic Auth, when configured, challenges every path but the health checks", () => {
  Deno.env.set("PLAYGROUND_BASIC_AUTH_USER", "user");
  Deno.env.set("PLAYGROUND_BASIC_AUTH_PASSWORD", "pass");
  try {
    const challenge = basicAuthChallenge(new Request("http://localhost/back-office"));
    assertEquals(challenge?.status, 401);
    assertEquals(challenge?.headers.get("www-authenticate"), 'Basic realm="Adyen TEST Playground"');
    const wrong = new Request("http://localhost/", {
      headers: { authorization: `Basic ${btoa("user:nope")}` },
    });
    assertEquals(basicAuthChallenge(wrong)?.headers.has("www-authenticate"), true);
    const right = new Request("http://localhost/", {
      headers: { authorization: `Basic ${btoa("user:pass")}` },
    });
    assertEquals(basicAuthChallenge(right), undefined);
    assertEquals(basicAuthChallenge(new Request("http://localhost/healthz")), undefined);
  } finally {
    Deno.env.delete("PLAYGROUND_BASIC_AUTH_USER");
    Deno.env.delete("PLAYGROUND_BASIC_AUTH_PASSWORD");
  }
  assertEquals(basicAuthChallenge(new Request("http://localhost/back-office")), undefined);
});

Deno.test("a rejected POST issues no cookies, so it cannot replace bootstrap's CSRF token", async () => {
  const app = new Hono();
  app.use("*", csrfProtection("test-secret", PUBLIC_ORIGIN));
  app.get("/api/bootstrap", (c) => c.json({ ok: true }));
  app.post("/api/x", (c) => c.json({ ok: true }));

  const rejected = await app.request("http://127.0.0.1:8001/api/x", { method: "POST" });
  assertEquals(rejected.status, 403);
  assertEquals(rejected.headers.getSetCookie(), []);

  const bootstrap = await app.request("http://127.0.0.1:8001/api/bootstrap");
  const issued = bootstrap.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  assertEquals(issued.some((cookie) => cookie.startsWith("adyen_csrf=")), true);
  assertEquals(issued.some((cookie) => cookie.startsWith("adyen_session=")), true);
});

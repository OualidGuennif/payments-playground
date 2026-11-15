import { test } from "bun:test";
import { assertEquals } from "../../testing/assert.ts";
import { Elysia } from "elysia";
import { serveSecurely } from "./base-api.ts";
import { basicAuthChallenge, requestOrigin, shopperIp } from "./security.ts";

const PUBLIC_ORIGIN = "http://127.0.0.1:8001";
const OPTIONS = { config: { signingSecret: "test-secret", publicOrigin: PUBLIC_ORIGIN } };

function request(url: string, origin?: string): Request {
  return new Request(url, { method: "POST", headers: origin ? { origin } : {} });
}

test("requestOrigin follows the browser when it is on the app's own host", () => {
  // `next dev` alone serves on its default port while .env still names dev:digital's.
  assertEquals(
    requestOrigin(request("http://localhost:5173/api/x", "http://localhost:5173"), PUBLIC_ORIGIN),
    "http://localhost:5173",
  );
  assertEquals(
    requestOrigin(request("http://127.0.0.1:8001/api/x", "http://localhost:8001"), PUBLIC_ORIGIN),
    "http://localhost:8001",
  );
});

test("requestOrigin falls back to PUBLIC_ORIGIN for a foreign or missing Origin", () => {
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

// The connection's address, as a server that knows it passes it.
function connection(hostname: string): string {
  return hostname;
}

function forwardedFor(value: string): Request {
  return new Request("http://localhost:5173/api/x", { headers: { "x-forwarded-for": value } });
}

test("shopperIp takes the first X-Forwarded-For entry over the proxy's connection", () => {
  assertEquals(
    shopperIp(forwardedFor("203.0.113.7, 10.0.0.2"), connection("10.0.0.9")),
    "203.0.113.7",
  );
  assertEquals(shopperIp(forwardedFor("2001:db8::1")), "2001:db8::1");
});

test("shopperIp falls back to the connection, unwrapping IPv4-mapped addresses", () => {
  assertEquals(
    shopperIp(request("http://localhost:5173/api/x"), connection("192.0.2.4")),
    "192.0.2.4",
  );
  assertEquals(shopperIp(forwardedFor("::ffff:192.0.2.5")), "192.0.2.5");
  assertEquals(shopperIp(forwardedFor("not-an-ip"), connection("::1")), "::1");
});

test("shopperIp gives nothing for a non-IP connection name or a forged non-IP", () => {
  assertEquals(
    shopperIp(request("http://localhost:5173/api/x"), connection("localhost")),
    undefined,
  );
  assertEquals(shopperIp(forwardedFor("<script>")), undefined);
  assertEquals(shopperIp(request("http://localhost:5173/api/x")), undefined);
});

test("CSRF still rejects a cross-origin POST that carries a valid token", async () => {
  const app = serveSecurely(
    new Elysia().post("/api/x", () => ({ ok: true })),
    OPTIONS,
  );
  const headers = { cookie: "adyen_csrf=token", "x-csrf-token": "token" };

  const sameOrigin = await app(
    new Request("http://localhost:5173/api/x", {
      method: "POST",
      headers: { ...headers, origin: "http://localhost:5173" },
    }),
  );
  assertEquals(sameOrigin.status, 200);

  const crossOrigin = await app(
    new Request("http://localhost:5173/api/x", {
      method: "POST",
      headers: { ...headers, origin: "https://evil.example" },
    }),
  );
  assertEquals(crossOrigin.status, 403);
});

test("Basic Auth, when configured, challenges every path but the health checks", () => {
  process.env.PLAYGROUND_BASIC_AUTH_USER = "user";
  process.env.PLAYGROUND_BASIC_AUTH_PASSWORD = "pass";
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
    delete process.env.PLAYGROUND_BASIC_AUTH_USER;
    delete process.env.PLAYGROUND_BASIC_AUTH_PASSWORD;
  }
  assertEquals(basicAuthChallenge(new Request("http://localhost/back-office")), undefined);
});

test("a rejected POST issues no cookies, so it cannot replace bootstrap's CSRF token", async () => {
  const app = serveSecurely(
    new Elysia().get("/api/bootstrap", () => ({ ok: true })).post("/api/x", () => ({ ok: true })),
    OPTIONS,
  );

  const rejected = await app(new Request("http://127.0.0.1:8001/api/x", { method: "POST" }));
  assertEquals(rejected.status, 403);
  assertEquals(rejected.headers.getSetCookie(), []);

  const bootstrap = await app(new Request("http://127.0.0.1:8001/api/bootstrap"));
  const issued = bootstrap.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  assertEquals(
    issued.some((cookie) => cookie.startsWith("adyen_csrf=")),
    true,
  );
  assertEquals(
    issued.some((cookie) => cookie.startsWith("adyen_session=")),
    true,
  );
});

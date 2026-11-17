import { test } from "bun:test";
import { assertEquals } from "../../testing/assert.ts";
import { Elysia } from "elysia";
import { serveSecurely } from "./base-api.ts";
import { basicAuthChallenge, rateLimiter, requestOrigin, shopperIp } from "./security.ts";

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

function behindCloudflare(address: string, forwarded?: string): Request {
  const headers: Record<string, string> = { "cf-connecting-ip": address };
  if (forwarded) headers["x-forwarded-for"] = forwarded;
  return new Request("http://localhost:5173/api/x", { headers });
}

// On Render, Cloudflare writes CF-Connecting-IP over any copy the caller sent and appends to
// X-Forwarded-For, so the first X-Forwarded-For entry is whatever the caller chose.
test("shopperIp never takes a forged first X-Forwarded-For entry", () => {
  assertEquals(
    shopperIp(
      behindCloudflare("198.51.100.4", "203.0.113.7, 198.51.100.4"),
      connection("10.0.0.9"),
    ),
    "198.51.100.4",
  );
  // Without Cloudflare's header, the entry the nearest proxy appended, over its connection.
  assertEquals(
    shopperIp(forwardedFor("203.0.113.7, 198.51.100.4"), connection("10.0.0.9")),
    "198.51.100.4",
  );
  assertEquals(shopperIp(forwardedFor("2001:db8::1")), "2001:db8::1");
});

test("shopperIp takes Cloudflare's address when there is no X-Forwarded-For", () => {
  assertEquals(shopperIp(behindCloudflare("2001:db8::5"), connection("10.0.0.9")), "2001:db8::5");
  assertEquals(shopperIp(behindCloudflare("<script>", "198.51.100.9")), "198.51.100.9");
});

test("the rate limit counts the caller, not a forged first entry", () => {
  const limit = rateLimiter(3);
  const caller = "198.51.100.4";
  for (let i = 0; i < 3; i += 1) {
    assertEquals(limit(behindCloudflare(caller, `203.0.113.${i}, ${caller}`)), undefined);
  }
  assertEquals(limit(behindCloudflare(caller, `203.0.113.9, ${caller}`))?.status, 429);
});

test("the rate limit never charges a victim named in the first entry", () => {
  const limit = rateLimiter(3);
  const forged = () => behindCloudflare("198.51.100.4", "192.0.2.77, 198.51.100.4");
  for (let i = 0; i < 4; i += 1) limit(forged());
  assertEquals(limit(forged())?.status, 429);
  assertEquals(limit(behindCloudflare("192.0.2.77", "192.0.2.77")), undefined);
});

test("the rate limit keys Cloudflare's address alone; no usable header is one local client", () => {
  const limit = rateLimiter(1);
  assertEquals(limit(behindCloudflare("198.51.100.4")), undefined);
  assertEquals(limit(behindCloudflare("198.51.100.5")), undefined);
  const local = rateLimiter(1);
  assertEquals(local(request("http://localhost:5173/api/x")), undefined);
  assertEquals(local(forwardedFor("not-an-ip"))?.status, 429);
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

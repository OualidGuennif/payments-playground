// The proxy: the shopper's pages and forms need the playground's Basic Auth and refuse cross-site
// writes; the agent protocol paths never ask for either.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterEach, beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const ORIGIN = "http://127.0.0.1:8003";
const PAIR = { user: "shopper", password: "not-a-secret" };
const SIGNED_IN = { authorization: `Basic ${btoa(`${PAIR.user}:${PAIR.password}`)}` };
const SHOPPER_PATHS = ["/account", "/consent/ar_test", "/device", "/oauth/decision"];
const SHOPPER_FORMS = ["/oauth/decision", "/oauth/device/verify"];
const KEYS = ["PLAYGROUND_BASIC_AUTH_USER", "PLAYGROUND_BASIC_AUTH_PASSWORD"] as const;

const saved = KEYS.map((key) => process.env[key]);
beforeEach(() => {
  process.env.PLAYGROUND_BASIC_AUTH_USER = PAIR.user;
  process.env.PLAYGROUND_BASIC_AUTH_PASSWORD = PAIR.password;
});
afterEach(() => {
  KEYS.forEach((key, i) => {
    const value = saved[i];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

const call = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`${ORIGIN}${path}`, init));

test("the matcher sends the device and consent forms through the proxy", () => {
  for (const path of ["/device", ...SHOPPER_FORMS]) expect(config.matcher).toContain(path);
});

test("the shopper's pages and forms ask for Basic Auth", () => {
  for (const path of SHOPPER_PATHS) expect(call(path).status).toBe(401);
  for (const path of SHOPPER_FORMS) expect(call(path, { method: "POST" }).status).toBe(401);
  for (const path of [...SHOPPER_PATHS, ...SHOPPER_FORMS])
    expect(call(path, { headers: SIGNED_IN }).status).toBe(200);
});

test("a cross-site write to a shopper form is refused, signed in or not", () => {
  for (const path of SHOPPER_FORMS) {
    const crossSite = { ...SIGNED_IN, "sec-fetch-site": "cross-site" };
    expect(call(path, { method: "POST", headers: crossSite }).status).toBe(403);
    const sameSite = { ...SIGNED_IN, "sec-fetch-site": "same-origin" };
    expect(call(path, { method: "POST", headers: sameSite }).status).toBe(200);
  }
});

test("the agent protocol paths never ask for Basic Auth", () => {
  for (const path of ["/mcp", "/oauth/token", "/oauth/device_authorization", "/ucp/v1/carts"])
    expect(call(path, { method: "POST" }).status).toBe(200);
});

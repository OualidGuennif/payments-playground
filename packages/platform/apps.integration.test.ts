import { afterAll, beforeAll, test } from "bun:test";
import { assertEquals } from "../../testing/assert.ts";
import { handle as digitalHandle } from "../../apps/adyen-digital/src/server/api.ts";
import { handle as stylingHandle } from "../../apps/adyen-v6-styling/src/server/api.ts";

// A local Basic Auth pair would answer 401 before the checks these tests pin.
const BASIC_AUTH = ["PLAYGROUND_BASIC_AUTH_USER", "PLAYGROUND_BASIC_AUTH_PASSWORD"] as const;
const saved = new Map<string, string | undefined>();
beforeAll(() => {
  for (const name of BASIC_AUTH) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});
afterAll(() => {
  for (const [name, value] of saved) {
    if (value !== undefined) process.env[name] = value;
  }
});

for (const [name, handle] of [
  ["digital", digitalHandle],
  ["styling", stylingHandle],
] as const) {
  test(`${name} health route responds without external credentials`, async () => {
    const response = await handle(new Request("http://localhost/api/health"));
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.status, "ok");
    assertEquals(body.environment, "TEST");
  });

  test(`${name} refuses a POST without the CSRF token`, async () => {
    const response = await handle(
      new Request("http://localhost/api/profiles", { method: "POST", body: "{}" }),
    );
    assertEquals(response.status, 403);
    assertEquals(response.headers.get("set-cookie"), null);
  });
}

test("digital refuses a webhook whose HMAC matches no profile", async () => {
  const response = await digitalHandle(
    new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        live: "false",
        notificationItems: [
          {
            NotificationRequestItem: {
              eventCode: "AUTHORISATION",
              merchantReference: "digital-unknown",
              pspReference: "TESTPSP0000000001",
              success: "true",
              amount: { value: 1000, currency: "EUR" },
              additionalData: { hmacSignature: "invalid" },
            },
          },
        ],
      }),
    }),
  );
  assertEquals(response.status, 401);
});

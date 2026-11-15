import { assertEquals } from "@std/assert";
import { api as digitalApi } from "../../apps/adyen-digital/api.ts";
import { api as stylingApi } from "../../apps/adyen-v6-styling/api.ts";

for (
  const [name, api] of [
    ["digital", digitalApi],
    ["styling", stylingApi],
  ] as const
) {
  Deno.test(`${name} health route responds without external credentials`, async () => {
    const response = await api.request("http://localhost/api/health");
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.status, "ok");
    assertEquals(body.environment, "TEST");
  });
}

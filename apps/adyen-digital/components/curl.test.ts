import { assertEquals, assertStringIncludes } from "@std/assert";
import { asCurl } from "./curl.ts";

Deno.test("a POST replays its body and leaves the API key to the environment", () => {
  const command = asCurl("POST", "https://checkout-test.adyen.com/v72/payments", {
    reference: "o'brien",
  });
  assertEquals(
    command.split(" \\\n")[0],
    "curl -X POST 'https://checkout-test.adyen.com/v72/payments'",
  );
  assertStringIncludes(command, `-H "X-API-Key: $ADYEN_API_KEY"`);
  // The quote in the value survives the single-quoted body.
  assertStringIncludes(command, `"reference": "o'\\''brien"`);
});

Deno.test("a GET sends no body", () => {
  const command = asCurl("GET", "https://checkout-test.adyen.com/v72/paymentLinks/PL123", {
    linkId: "PL123",
  });
  assertStringIncludes(command, "/paymentLinks/PL123'");
  assertEquals(command.includes(" -d "), false);
});

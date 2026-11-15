import { test } from "bun:test";
import { assertEquals, assertThrows } from "../../testing/assert.ts";
import { rejectRawCardData, sanitize } from "./sanitize.ts";

test("only real infrastructure credentials are redacted before persistence", () => {
  const safe = sanitize({
    apiKey: "AQE-secret",
    authorization: "Bearer secret",
    shopperEmail: "shopper@example.com",
    nested: {
      sessionData: "session-secret",
      sdkData: "sdk-blob",
      harmless: "visible",
    },
  }) as Record<string, unknown>;

  assertEquals(safe.apiKey, "[redacted]");
  assertEquals(safe.authorization, "[redacted]");
  // This is a TEST playground: fixture shopper data and Adyen's opaque
  // sessionData/sdkData blobs stay in full so the inspector stays useful.
  assertEquals(safe.shopperEmail, "shopper@example.com");
  assertEquals((safe.nested as Record<string, unknown>).sessionData, "session-secret");
  assertEquals((safe.nested as Record<string, unknown>).sdkData, "sdk-blob");
  assertEquals((safe.nested as Record<string, unknown>).harmless, "visible");
});

test("raw PAN and CVC are rejected while Adyen encrypted fields are accepted", () => {
  assertThrows(
    () => rejectRawCardData({ paymentMethod: { cardNumber: "4111111111111111" } }),
    Error,
    "Raw card data is forbidden",
  );
  rejectRawCardData({
    paymentMethod: {
      encryptedCardNumber: "adyenjs_0_1_25$encrypted",
      encryptedSecurityCode: "adyenjs_0_1_25$encrypted",
    },
  });
});

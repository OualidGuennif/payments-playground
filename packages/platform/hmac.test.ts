import { test } from "bun:test";
import { assertEquals } from "../../testing/assert.ts";
import {
  calculateStandardHmac,
  standardWebhookSigningString,
  verifyHeaderHmac,
  verifyStandardHmac,
} from "./hmac.ts";

test("header HMAC follows the RFC 4231 SHA-256 vector", async () => {
  const key = "0b".repeat(20);
  const signature = "sDRMYdjbOFNcqK/OrwvxK4gdwgDJgz2nJuk3bC4yz/c=";
  assertEquals(await verifyHeaderHmac("Hi There", signature, key), true);
  assertEquals(await verifyHeaderHmac("Hi There!", signature, key), false);
});

test("standard webhook signing string escapes colons and backslashes", () => {
  assertEquals(
    standardWebhookSigningString({
      pspReference: "PSP:1",
      merchantAccountCode: "Merchant\\TEST",
      merchantReference: "ORDER-1",
      amount: { value: 1250, currency: "EUR" },
      eventCode: "AUTHORISATION",
      success: "true",
    }),
    "PSP\\:1::Merchant\\\\TEST:ORDER-1:1250:EUR:AUTHORISATION:true",
  );
});

test("standard webhook HMAC accepts the signed item and rejects mutation", async () => {
  const key = "11".repeat(32);
  const item = {
    pspReference: "PSP-TEST-1",
    merchantAccountCode: "TestMerchant",
    merchantReference: "ORDER-42",
    amount: { value: 4200, currency: "EUR" },
    eventCode: "AUTHORISATION",
    success: "true",
    additionalData: {} as { hmacSignature?: string },
  };
  item.additionalData.hmacSignature = await calculateStandardHmac(item, key);
  assertEquals(await verifyStandardHmac(item, key), true);
  item.amount.value = 4300;
  assertEquals(await verifyStandardHmac(item, key), false);
});

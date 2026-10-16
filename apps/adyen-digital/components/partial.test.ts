import { assertEquals } from "@std/assert";
import { orderProgress, partialAmount } from "./partial.ts";

Deno.test("an order reads as paid and left from its amount and remainingAmount", () => {
  assertEquals(
    orderProgress({
      amount: { value: 10999, currency: "EUR" },
      remainingAmount: { value: 5999, currency: "EUR" },
    }),
    { total: 10999, paid: 5000, remaining: 5999, currency: "EUR" },
  );
  assertEquals(orderProgress({ pspReference: "X" }), null);
  assertEquals(orderProgress(undefined), null);
});

Deno.test("a gift card pays what its balance covers, anything else pays the rest", () => {
  // First payment: no order yet, a 50.00 gift card on 109.99.
  assertEquals(partialAmount({ total: 10999, remaining: null, giftCardBalance: 5000 }), 5000);
  // A balance larger than what is left pays only what is left.
  assertEquals(partialAmount({ total: 10999, remaining: 5999, giftCardBalance: 8000 }), 5999);
  // The card after the gift card.
  assertEquals(partialAmount({ total: 10999, remaining: 5999, giftCardBalance: null }), 5999);
  // No order at all: the full amount.
  assertEquals(partialAmount({ total: 10999, remaining: null, giftCardBalance: null }), 10999);
});

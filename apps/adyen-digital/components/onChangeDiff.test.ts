import { assertEquals } from "@std/assert";
import { diff, onChangeSummary } from "./onChangeDiff.ts";

// Shaped like the onChange state Adyen Web 6.46 sends for a card.
function state(overrides: {
  holderName?: string;
  encryptedCardNumber?: string;
  isValid?: boolean;
  errors?: Record<string, unknown>;
  valid?: Record<string, boolean>;
  sdkData?: string;
}) {
  return {
    data: {
      paymentMethod: {
        type: "scheme",
        brand: "visa",
        holderName: overrides.holderName ?? "",
        encryptedCardNumber: overrides.encryptedCardNumber,
        sdkData: overrides.sdkData ?? "eyJjcmVhdGVkQXQiOjF9",
      },
      browserInfo: { language: "fr" },
    },
    isValid: overrides.isValid ?? false,
    errors: overrides.errors ?? { encryptedCardNumber: null, holderName: null },
    valid: overrides.valid ?? { encryptedCardNumber: false, holderName: false },
  };
}

Deno.test("the first onChange is summarised by method, brand and validity", () => {
  assertEquals(onChangeSummary(state({}), null), ["scheme", "visa", "form incomplete"]);
});

Deno.test("an encrypted value reads as entered, not as a changed blob", () => {
  const before = state({ encryptedCardNumber: "adyenjs_0_1_25$AAA" });
  const after = state({ encryptedCardNumber: "adyenjs_0_1_25$BBB" });
  assertEquals(diff(before, after), []);
  const typed = state({});
  assertEquals(onChangeSummary(before, diff(typed, before)), ["encryptedCardNumber entered"]);
});

Deno.test("sdkData and browserInfo changing alone is not a change", () => {
  const before = state({ sdkData: "one" });
  const after = state({ sdkData: "two" });
  assertEquals(onChangeSummary(after, diff(before, after)), ["no change"]);
});

Deno.test("null and false both mean no error; only a real error is reported", () => {
  const clean = state({ errors: { encryptedCardNumber: null } });
  const untouched = state({ errors: { encryptedCardNumber: false } });
  assertEquals(onChangeSummary(untouched, diff(clean, untouched)), ["internal update"]);

  const failed = state({
    errors: { encryptedCardNumber: { errorI18n: "Incomplete card number" } },
  });
  assertEquals(onChangeSummary(failed, diff(untouched, failed)), [
    "encryptedCardNumber: Incomplete card number",
  ]);
  assertEquals(onChangeSummary(clean, diff(failed, clean)), ["encryptedCardNumber error cleared"]);
});

Deno.test("validity flips and typed values read as short phrases", () => {
  const before = state({ holderName: "le" });
  const after = state({
    holderName: "lee",
    isValid: true,
    valid: { encryptedCardNumber: true, holderName: true },
  });
  assertEquals(onChangeSummary(after, diff(before, after)), [
    "holderName lee",
    "form valid",
    "encryptedCardNumber ✓",
    "holderName ✓",
  ]);
});

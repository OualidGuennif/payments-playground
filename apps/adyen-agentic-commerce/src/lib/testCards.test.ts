import { expect, test } from "bun:test";
import { TEST_CARDS as SHARED } from "../../../../packages/ui/testData";
import { TEST_CARDS } from "./testCards";

test("the checkout's test cards are the suite's published Adyen TEST cards, value for value", () => {
  expect(TEST_CARDS.length).toBeGreaterThan(0);
  for (const card of TEST_CARDS) {
    const shared = SHARED.find((s) => s.pan === card.pan);
    expect(shared, card.pan).toBeDefined();
    expect({ expiry: card.expiry, cvc: card.cvc }).toEqual({
      expiry: shared?.expiry ?? "",
      cvc: shared?.cvc ?? "",
    });
  }
});

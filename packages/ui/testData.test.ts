// Spec: knowledge/components/ui-package.md
import { expect, test } from "bun:test";
import { TEST_CARDS as AGENTIC } from "../../apps/adyen-agentic-commerce/src/lib/testCards";
import { TEST_CARDS } from "./testData";

// The agentic store keeps its own copy because its image carries no package source; this test
// lives here, outside that image, so the copy cannot drift from the shared list.
test("the agentic checkout's test cards are these published Adyen TEST cards, value for value", () => {
  expect(AGENTIC.length).toBeGreaterThan(0);
  for (const card of AGENTIC) {
    const shared = TEST_CARDS.find((s) => s.pan === card.pan);
    expect(shared, card.pan).toBeDefined();
    expect({ expiry: card.expiry, cvc: card.cvc }).toEqual({
      expiry: shared?.expiry ?? "",
      cvc: shared?.cvc ?? "",
    });
  }
});

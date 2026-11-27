// A card's swatches show and open each colour's own picture (storefront spec, Shop).
// Spec: knowledge/components/agentic-storefront.md
import { describe, expect, test } from "bun:test";
import { PRODUCTS, variantsOf } from "@/server/catalog/catalog";
import { cardOf } from "./cardOf";

describe("a product card", () => {
  test("every colour names a variant of that colour, the first colour's is the card's first", () => {
    for (const product of PRODUCTS) {
      const card = cardOf(product);
      const variants = new Map(variantsOf(product).map((v) => [v.id, v]));
      expect(Object.keys(card.colourVariants)).toEqual(product.colours.map((c) => c.id));
      for (const colour of product.colours)
        expect(variants.get(card.colourVariants[colour.id]!)?.colour.id).toBe(colour.id);
      expect(card.colourVariants[product.colours[0]!.id]).toBe(card.firstVariant);
    }
  });
});

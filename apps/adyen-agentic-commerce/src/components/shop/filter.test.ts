import { describe, expect, test } from "bun:test";
import { shopItemOf } from "@/components/cardOf";
import { PRODUCTS } from "@/server/catalog/catalog";
import { filterItems } from "./filter";

const ITEMS = PRODUCTS.map(shopItemOf);

describe("the shop's filters", () => {
  test("with no filter every piece shows, in catalogue order", () => {
    expect(filterItems(ITEMS, {}).map((p) => p.id)).toEqual(PRODUCTS.map((p) => p.id));
  });

  test("a department, New in and On sale keep only their pieces", () => {
    const footwear = filterItems(ITEMS, { category: "footwear" });
    expect(footwear.length).toBeGreaterThan(0);
    expect(footwear.every((p) => p.category === "footwear")).toBe(true);
    const fresh = filterItems(ITEMS, { collection: "new" });
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((p) => p.badge === "New")).toBe(true);
    const sale = filterItems(ITEMS, { sale: "1" });
    expect(sale.length).toBeGreaterThan(0);
    expect(sale.every((p) => p.compareAt && p.compareAt > p.price)).toBe(true);
  });

  test("price bands split every piece once, bounds included below and excluded above", () => {
    const bands = ["u50", "50-100", "100-200", "o200"].map(
      (price) => filterItems(ITEMS, { price }).length,
    );
    expect(bands.reduce((a, b) => a + b, 0)).toBe(ITEMS.length);
    expect(
      filterItems(ITEMS, { price: "50-100" }).every((p) => p.price >= 5000 && p.price < 10000),
    ).toBe(true);
  });

  test("for women leaves out men's pieces and keeps unisex ones", () => {
    const women = filterItems(ITEMS, { gender: "women" });
    expect(women.some((p) => p.gender === "male")).toBe(false);
    expect(women.some((p) => p.gender === "unisex")).toBe(ITEMS.some((p) => p.gender === "unisex"));
  });

  test("colours and sizes match any of the ones picked", () => {
    const colour = ITEMS[0]?.colours[0]?.id ?? "";
    const other = ITEMS.find((p) => !p.colours.some((c) => c.id === colour))?.colours[0]?.id;
    expect(other).toBeDefined();
    const both = filterItems(ITEMS, { colour: `${colour},${other}` });
    expect(both.every((p) => p.colours.some((c) => c.id === colour || c.id === other))).toBe(true);
    expect(both.length).toBeGreaterThan(filterItems(ITEMS, { colour }).length);
    const sized = filterItems(ITEMS, { size: "M" });
    expect(sized.length).toBeGreaterThan(0);
    expect(sized.every((p) => p.sizes.includes("M"))).toBe(true);
  });

  test("search needs every word and reads a plural as its singular", () => {
    const boots = filterItems(ITEMS, { q: "boots" });
    expect(boots.length).toBeGreaterThan(0);
    expect(filterItems(ITEMS, { q: "boot" }).map((p) => p.id)).toEqual(boots.map((p) => p.id));
    expect(filterItems(ITEMS, { q: "boots zzzz" })).toEqual([]);
  });

  test("sorts by price both ways, by rating and New first, without touching the input", () => {
    const before = ITEMS.map((p) => p.id);
    const up = filterItems(ITEMS, { sort: "price-asc" }).map((p) => p.price);
    expect(up).toEqual([...up].sort((a, b) => a - b));
    const down = filterItems(ITEMS, { sort: "price-desc" }).map((p) => p.price);
    expect(down).toEqual([...down].sort((a, b) => b - a));
    const rated = filterItems(ITEMS, { sort: "rating" }).map((p) => p.rating);
    expect(rated).toEqual([...rated].sort((a, b) => b - a));
    const fresh = filterItems(ITEMS, { sort: "new" });
    const firstOld = fresh.findIndex((p) => p.badge !== "New");
    expect(fresh.slice(firstOld).some((p) => p.badge === "New")).toBe(false);
    expect(ITEMS.map((p) => p.id)).toEqual(before);
  });
});

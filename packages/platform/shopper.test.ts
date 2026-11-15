import { test } from "bun:test";
import { assertEquals, assertNotEquals } from "../../testing/assert.ts";
import { weeklyShopperReference } from "./shopper.ts";

test("shopperReference stays constant within the same week", () => {
  const monday = new Date("2026-07-27T03:00:00Z");
  const sundayNight = new Date("2026-08-02T23:59:00Z");
  assertEquals(weeklyShopperReference(monday), weeklyShopperReference(sundayNight));
});

test("shopperReference rotates at the Sunday-night/Monday UTC boundary", () => {
  const sundayNight = new Date("2026-08-02T23:59:00Z");
  const nextMonday = new Date("2026-08-03T00:01:00Z");
  assertNotEquals(weeklyShopperReference(sundayNight), weeklyShopperReference(nextMonday));
});

test("shopperReference has a stable, readable shape", () => {
  assertEquals(
    weeklyShopperReference(new Date("2026-07-27T12:00:00Z")),
    "playground-shopper-2026-07-27",
  );
});

// Spec: knowledge/components/adyen-agentic-commerce.md
// The store's delivery choices: what each costs, and which choices a request may name.
import { describe, expect, test } from "bun:test";
import {
  ADDRESSES,
  DEFAULT_DELIVERY,
  deliveryFee,
  EXPRESS_FEE,
  FREE_SHIPPING_FROM,
  PICKUP_POINTS,
  parseDelivery,
  placeOf,
  STANDARD_FEE,
  shippingText,
  withMethod,
} from "./delivery";

describe("fees", () => {
  test("standard is free from 100 EUR, express always costs, a pickup point never does", () => {
    expect(deliveryFee("standard", 1200)).toBe(STANDARD_FEE);
    expect(deliveryFee("standard", FREE_SHIPPING_FROM)).toBe(0);
    expect(deliveryFee("express", 1200)).toBe(EXPRESS_FEE);
    expect(deliveryFee("express", FREE_SHIPPING_FROM)).toBe(EXPRESS_FEE);
    expect(deliveryFee("pickup", 1200)).toBe(0);
  });

  test("an empty bag costs nothing, whatever the method", () => {
    for (const method of ["standard", "express", "pickup"] as const)
      expect(deliveryFee(method, 0)).toBe(0);
  });

  test("the totals line names the method", () => {
    expect(shippingText("express", EXPRESS_FEE)).toBe("Express shipping");
    expect(shippingText("pickup", 0)).toBe("Pickup point");
    expect(shippingText("standard", STANDARD_FEE)).toBe("Standard shipping");
    expect(shippingText("standard", 0)).toBe("Free shipping");
  });
});

describe("choices", () => {
  test("the default is standard to the first address", () => {
    expect(DEFAULT_DELIVERY).toEqual({ method: "standard", placeId: ADDRESSES[0]!.id });
    expect(placeOf(DEFAULT_DELIVERY).street).toBe("7 avenue Daumesnil");
  });

  test("a request names a known method and one of its own places, nothing else", () => {
    const relay = PICKUP_POINTS[0]!.id;
    const home = ADDRESSES[0]!.id;
    expect(parseDelivery({ method: "pickup", placeId: relay })).toEqual({
      method: "pickup",
      placeId: relay,
    });
    expect(parseDelivery({ method: "express", placeId: home, extra: 1 })).toEqual({
      method: "express",
      placeId: home,
    });
    for (const input of [
      { method: "pickup", placeId: home },
      { method: "standard", placeId: relay },
      { method: "drone", placeId: home },
      { method: "standard", placeId: "unknown-place" },
      { method: "standard" },
      "standard",
      null,
    ])
      expect(parseDelivery(input)).toBeUndefined();
  });

  test("a method change keeps a place that still fits, else takes the first of the new list", () => {
    const office = ADDRESSES[1]!.id;
    expect(withMethod({ method: "standard", placeId: office }, "express")).toEqual({
      method: "express",
      placeId: office,
    });
    expect(withMethod({ method: "standard", placeId: office }, "pickup")).toEqual({
      method: "pickup",
      placeId: PICKUP_POINTS[0]!.id,
    });
  });
});

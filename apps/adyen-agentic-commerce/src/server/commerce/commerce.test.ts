// Prices, line parsing and the checkout assessment: everything the server decides instead of the
// agent, and the shopper's Drop-in path.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { beforeEach, describe, expect, test } from "bun:test";
import * as commerce from "./commerce";
import { list, put } from "../core/db";
import { freshStore } from "../testing/agent";
import { fake } from "../testing/fake-adyen";

const SOCKS = "velune-rib-socks-oat-one-size"; // 1200
const OXFORD = "velune-oxford-shirt-white-s"; // 5900
const BEANIE = "velune-wool-beanie-oat-one-size"; // 2900
const SOLD_OUT = "velune-weekender-navy-one-size";
const line = (variantId: string, quantity = 1): commerce.Line => ({
  id: `li_${variantId}`,
  variantId,
  quantity,
});
const items = (...ids: string[]) => ids.map((id) => ({ item: { id }, quantity: 1 }));

beforeEach(() => freshStore());

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof commerce.CommerceError) return error.msg.code;
    throw error;
  }
  return undefined;
}

describe("pricing", () => {
  test("shipping is added under 100 EUR", () => {
    expect(commerce.price([line(SOCKS)])).toMatchObject({
      subtotal: 1200,
      fulfillment: 495,
      total: 1695,
    });
  });

  test("shipping is free from exactly 100 EUR", () => {
    expect(commerce.price([line(OXFORD), line(BEANIE), line(SOCKS)])).toMatchObject({
      subtotal: 10000,
      fulfillment: 0,
      total: 10000,
    });
  });

  test("an empty checkout costs nothing", () => {
    expect(commerce.price([]).total).toBe(0);
  });

  test("totals carry exactly one subtotal and one total", () => {
    const types = commerce.totals([line(SOCKS, 3)]).map((t) => t.type);
    expect(types.filter((t) => t === "subtotal")).toHaveLength(1);
    expect(types.filter((t) => t === "total")).toHaveLength(1);
  });
});

describe("line items", () => {
  test("line_items must be an array of at most 20", () => {
    expect(code(() => commerce.parseLines("socks"))).toBe("invalid_line_items");
    expect(
      code(() => commerce.parseLines(Array.from({ length: 21 }, () => ({ item: { id: SOCKS } })))),
    ).toBe("too_many_line_items");
  });

  test("each line needs a known item id", () => {
    expect(code(() => commerce.parseLines([{ quantity: 1 }]))).toBe("invalid_line_item");
    expect(code(() => commerce.parseLines(items("velune-nothing")))).toBe("item_not_found");
  });

  test("a product with several variants needs a variant id", () => {
    expect(code(() => commerce.parseLines(items("velune-oxford-shirt")))).toBe("variant_required");
  });

  test("quantity is an integer from 1 to 10", () => {
    for (const quantity of [0, 11, 1.5, "2"]) {
      expect(code(() => commerce.parseLines([{ item: { id: SOCKS }, quantity }]))).toBe(
        "invalid_quantity",
      );
    }
  });

  test("the same variant twice is merged and capped", () => {
    expect(
      commerce.parseLines([
        { item: { id: SOCKS }, quantity: 7 },
        { item: { id: SOCKS }, quantity: 7 },
      ]),
    ).toEqual([expect.objectContaining({ variantId: SOCKS, quantity: 10 })]);
  });

  test("an update keeps the line ids the agent already holds", () => {
    const [first] = commerce.parseLines(items(SOCKS));
    const [next] = commerce.parseLines(
      [{ id: first!.id, item: { id: SOCKS }, quantity: 2 }],
      [first!],
    );
    expect(next!.id).toBe(first!.id);
  });
});

describe("assessment", () => {
  const checkout = (lines: commerce.Line[], change: Partial<commerce.Checkout> = {}) =>
    commerce.createCheckout({
      line_items: lines.map((l) => ({ item: { id: l.variantId }, quantity: l.quantity })),
      buyer: { email: "a@example.com" },
      ...change,
    });

  test("a sold-out variant makes the checkout incomplete", () => {
    const result = commerce.assess(checkout([line(SOLD_OUT)]), undefined, []);
    expect(result.status).toBe("incomplete");
    expect(result.messages.map((m) => m.code)).toContain("out_of_stock");
  });

  test("an anonymous checkout without an email asks for one", () => {
    const c = commerce.createCheckout({ line_items: items(SOCKS) });
    expect(commerce.assess(c, undefined, []).messages.map((m) => m.code)).toContain(
      "missing_buyer_email",
    );
  });

  test("an expired checkout reads as canceled", () => {
    const c = checkout([line(SOCKS)]);
    const expired = put("checkouts", c.id, {
      ...c,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(commerce.assess(expired, undefined, []).status).toBe("canceled");
  });
});

describe("the shopper's Drop-in", () => {
  test("a session is priced by the server and gets its own reference per attempt", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOCKS),
      buyer: { email: "a@example.com" },
    });
    const first = await commerce.startShopperSession(c);
    const second = await commerce.startShopperSession(commerce.loadCheckout(c.id, "browser"));
    expect(first.amount).toBe(1695);
    expect(first.clientKey).toStartWith("test_");
    expect([first.id, second.id]).toEqual([`CS_${c.id}-s1`, `CS_${c.id}-s2`]);
  });

  test("an incomplete checkout cannot start a payment", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOLD_OUT),
      buyer: { email: "a@example.com" },
    });
    expect(commerce.startShopperSession(c)).rejects.toThrow("cannot be paid");
  });

  test("an unknown session id is refused", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOCKS),
      buyer: { email: "a@example.com" },
    });
    expect(commerce.finishShopperSession(c, "CS_forged", "x")).rejects.toThrow(
      "Unknown payment session",
    );
  });

  test("an edit after the session started does not change what the order records", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOCKS),
      buyer: { email: "a@example.com" },
    });
    const session = await commerce.startShopperSession(c);
    commerce.updateCheckout(commerce.loadCheckout(c.id, "browser"), {
      line_items: items(SOCKS, OXFORD),
    });
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPEDIT", amount: 1695 }],
    };
    await commerce.finishShopperSession(commerce.loadCheckout(c.id, "browser"), session.id, "r");
    expect(list<commerce.Order>("orders")).toEqual([
      expect.objectContaining({
        total: 1695,
        lines: [expect.objectContaining({ variantId: SOCKS, quantity: 1 })],
      }),
    ]);
  });

  test("Adyen reporting another amount places no order and holds the checkout", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOCKS),
      buyer: { email: "a@example.com" },
    });
    const session = await commerce.startShopperSession(c);
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPODD", amount: 999 }],
    };
    await commerce.finishShopperSession(commerce.loadCheckout(c.id, "browser"), session.id, "r");
    expect(list<commerce.Order>("orders")).toHaveLength(0);
    const held = commerce.loadCheckout(c.id, "browser");
    expect(held.phase).toBe("complete_in_progress");
    expect(held.lastMessage?.code).toBe("amount_mismatch");
  });

  test("two result calls for one Authorised session place one order", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOCKS),
      buyer: { email: "a@example.com" },
    });
    const session = await commerce.startShopperSession(c);
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPSHOPPER" }],
    };
    const loaded = commerce.loadCheckout(c.id, "browser");
    await Promise.all([
      commerce.finishShopperSession(loaded, session.id, "r"),
      commerce.finishShopperSession(loaded, session.id, "r"),
    ]);
    expect(list<commerce.Order>("orders")).toEqual([
      expect.objectContaining({ pspReference: "PSPSHOPPER", paidBy: "shopper", total: 1695 }),
    ]);
    expect(commerce.loadCheckout(c.id, "browser").phase).toBe("completed");
  });
});

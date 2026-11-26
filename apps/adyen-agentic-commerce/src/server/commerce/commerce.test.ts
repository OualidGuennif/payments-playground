// Prices, line parsing and the checkout assessment: everything the server decides instead of the
// agent, and the shopper's Drop-in path.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { beforeEach, describe, expect, test } from "bun:test";
import * as commerce from "./commerce";
import { handle } from "../api";
import { list, put } from "../core/db";
import { freshStore, ORIGIN, randomIp, signUpCustomer } from "../testing/agent";
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

describe("delivery", () => {
  const open = () =>
    commerce.createCheckout({ line_items: items(SOCKS), buyer: { email: "a@example.com" } });

  test("express is priced by the server and named on the totals", () => {
    const c = commerce.setDelivery(open(), { method: "express", placeId: "home" });
    const saved = commerce.loadCheckout(c.id, "browser");
    expect(commerce.price(saved.lines, saved.delivery)).toMatchObject({
      subtotal: 1200,
      fulfillment: 995,
      total: 2195,
    });
    const shipping = commerce
      .totals(saved.lines, saved.delivery)
      .find((t) => t.type === "fulfillment");
    expect(shipping?.display_text).toBe("Express shipping");
  });

  test("a pickup point costs nothing", () => {
    const c = commerce.setDelivery(open(), { method: "pickup", placeId: "relay-daumesnil" });
    expect(commerce.price(c.lines, c.delivery).total).toBe(1200);
  });

  test("no change while a payment holds the checkout or once it left the open phase", async () => {
    const c = open();
    const session = await commerce.startShopperSession(c);
    const paying = commerce.claimWebPayment(c.id, session.id);
    const relay = { method: "pickup", placeId: "relay-daumesnil" } as const;
    expect(code(() => commerce.setDelivery(paying, relay))).toBe("payment_in_progress");
    const closed = { ...open(), phase: "completed" as const };
    expect(code(() => commerce.setDelivery(closed, { method: "express", placeId: "home" }))).toBe(
      "checkout_not_editable",
    );
  });

  test("the order is charged and recorded with the delivery the payment was priced with", async () => {
    const c = commerce.setDelivery(open(), { method: "express", placeId: "office" });
    const session = await commerce.startShopperSession(c);
    expect(session.amount).toBe(2195);
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPEXPRESS", amount: 2195 }],
    };
    await commerce.finishShopperSession(commerce.loadCheckout(c.id, "browser"), session.id, "r");
    expect(list<commerce.Order>("orders")).toEqual([
      expect.objectContaining({ total: 2195, delivery: { method: "express", placeId: "office" } }),
    ]);
  });

  test("another address at the same price, chosen before Pay, is where the order ships", async () => {
    const c = open();
    const session = await commerce.startShopperSession(c);
    commerce.setDelivery(commerce.loadCheckout(c.id, "browser"), {
      method: "standard",
      placeId: "family",
    });
    commerce.claimWebPayment(c.id, session.id);
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPFAMILY", amount: 1695 }],
    };
    await commerce.finishShopperSession(commerce.loadCheckout(c.id, "browser"), session.id, "r");
    expect(list<commerce.Order>("orders")).toEqual([
      expect.objectContaining({ total: 1695, delivery: { method: "standard", placeId: "family" } }),
    ]);
  });

  test("a choice made after the payment was sent never changes what that payment's order records", async () => {
    // The form's session priced the default; the delivery changes before any claim, and Adyen
    // authorises the amount that was sent.
    const c = open();
    const session = await commerce.startShopperSession(c);
    commerce.setDelivery(commerce.loadCheckout(c.id, "browser"), {
      method: "express",
      placeId: "home",
    });
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPLATE", amount: 1695 }],
    };
    await commerce.finishShopperSession(commerce.loadCheckout(c.id, "browser"), session.id, "r");
    expect(list<commerce.Order>("orders")).toEqual([
      expect.objectContaining({
        total: 1695,
        fulfillment: 495,
        delivery: { method: "standard", placeId: "home" },
      }),
    ]);
  });

  test("a change of price after the form opened is refused at Pay, never charged", async () => {
    const c = open();
    const session = await commerce.startShopperSession(c);
    commerce.setDelivery(commerce.loadCheckout(c.id, "browser"), {
      method: "express",
      placeId: "home",
    });
    expect(code(() => commerce.claimWebPayment(c.id, session.id))).toBe("checkout_changed");
  });
});

describe("POST /api/checkouts/:id/delivery", () => {
  const choose = async (id: string, body: unknown, cookie?: string) => {
    const response = await handle(
      new Request(`${ORIGIN}/api/checkouts/${id}/delivery`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": randomIp(),
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  test("a listed choice answers the checkout priced with it; anything else is refused", async () => {
    const c = commerce.createCheckout({
      line_items: items(SOCKS),
      buyer: { email: "a@example.com" },
    });
    const chosen = await choose(c.id, { method: "express", placeId: "office" });
    expect(chosen.status).toBe(200);
    expect(chosen.body).toMatchObject({
      total: 2195,
      delivery: { method: "express", placeId: "office" },
    });
    const forged = await choose(c.id, { method: "pickup", placeId: "office" });
    expect(forged).toMatchObject({ status: 400, body: { code: "invalid_delivery" } });
    expect(commerce.loadCheckout(c.id, "browser").delivery?.placeId).toBe("office");
  });

  test("another account's checkout reads as missing", async () => {
    const owner = await signUpCustomer();
    const someone = await signUpCustomer();
    const created = await handle(
      new Request(`${ORIGIN}/api/checkouts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": randomIp(),
          cookie: owner.cookie,
        },
        body: JSON.stringify({ lines: [{ variantId: SOCKS, quantity: 1 }], email: owner.email }),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    const home = { method: "standard", placeId: "home" };
    expect((await choose(id, home, someone.cookie)).status).toBe(404);
    expect((await choose(id, home)).status).toBe(404);
    expect((await choose(id, home, owner.cookie)).status).toBe(200);
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

// The widgets' decisions without a DOM: which variant a choice names, what a "By hand" button
// sends, and that "With the assistant" sends only a sentence (invariant 29).
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import {
  addCall,
  type BagView,
  bagView,
  catalogView,
  choose,
  contextFor,
  offered,
  payCall,
  quantityCall,
  say,
  searchCall,
  type UcpProduct,
  variantFor,
} from "./logic";

const KEY = "11111111-1111-4111-8111-111111111111";
const money = (amount: number) => ({ amount, currency: "EUR" });
const variant = (colour: string, size: string, available = true) => ({
  id: `trench-${colour.toLowerCase()}-${size.toLowerCase()}`,
  price: money(18900),
  availability: { available },
  options: [
    { name: "colour", id: colour.toLowerCase(), label: colour },
    { name: "size", label: size },
  ],
});
const TRENCH: UcpProduct = {
  id: "trench",
  title: "Trench coat",
  options: [
    {
      name: "colour",
      values: [
        { id: "sand", label: "Sand" },
        { id: "navy", label: "Navy" },
      ],
    },
    { name: "size", values: [{ label: "S" }, { label: "M" }] },
  ],
  variants: [
    variant("Sand", "S"),
    variant("Sand", "M"),
    variant("Navy", "S"),
    variant("Navy", "M", false),
  ],
};

const envelope = (capability: string) => ({ ucp: { capabilities: { [capability]: [{}] } } });
const line = (id: string, quantity: number, amount: number) => ({
  id: `li_${id}`,
  item: { id, title: id, price: amount, image_url: `https://store.example/api/art/${id}.svg` },
  quantity,
  totals: [{ type: "total", amount: amount * quantity }],
});
const cart = (lines = [line("socks", 1, 1200)]) =>
  bagView({
    ...envelope("dev.ucp.shopping.cart"),
    id: "crt_1",
    status: "active",
    currency: "EUR",
    line_items: lines,
    totals: [{ type: "total", amount: 1695 }],
  }) as BagView;
const checkout = (status = "ready_for_complete", extra: Record<string, unknown> = {}) =>
  bagView({
    ...envelope("dev.ucp.shopping.checkout"),
    id: "chk_1",
    status,
    currency: "EUR",
    line_items: [line("socks", 1, 1200)],
    totals: [
      { type: "subtotal", amount: 1200 },
      { type: "fulfillment", amount: 495 },
      { type: "total", amount: 1695 },
    ],
    payment: {
      instruments: [
        {
          id: "alias_visa",
          handler_id: "saved_card",
          display: { brand: "visa", last_digits: "1111", expiry_month: 3, expiry_year: 2030 },
        },
      ],
    },
    continue_url: "https://store.example/checkout/chk_1",
    ...extra,
  }) as BagView;

describe("views of UCP answers", () => {
  test("a search answer is the carousel; a cart and a checkout are the bag", () => {
    const view = catalogView({
      ...envelope("dev.ucp.shopping.catalog.search"),
      products: [TRENCH, { nope: true }],
      pagination: { has_next_page: true, cursor: "abc", total_count: 12 },
    });
    expect(view).toMatchObject({ hasNext: true, cursor: "abc", total: 12 });
    expect(view?.products.map((p) => p.id)).toEqual(["trench"]);
    expect(cart()).toMatchObject({ kind: "cart", id: "crt_1", total: 1695 });
    expect(checkout()).toMatchObject({
      kind: "checkout",
      subtotal: 1200,
      shipping: 495,
      instruments: [{ id: "alias_visa", label: "Visa •••• 1111 · 03/30" }],
    });
    expect(bagView({ id: "x", products: [] })).toBeUndefined();
  });

  test("only saved_card instruments become choices; nothing else of a card is read", () => {
    const bag = checkout("ready_for_complete", {
      payment: {
        instruments: [
          { id: "nt", handler_id: "network_token" },
          {
            id: "alias_mc",
            handler_id: "saved_card",
            display: { brand: "mc", last_digits: "4444" },
          },
        ],
      },
    });
    expect(bag.instruments).toEqual([{ id: "alias_mc", label: "Mc •••• 4444" }]);
  });

  test("the shopper reads plain words, not the agent's message, and the budget once", () => {
    const error = (code: string, content: string) => ({ type: "error", code, content });
    const bag = checkout("requires_escalation", {
      messages: [
        error("spend_limit_exceeded", "Total 18900 exceeds ... 15000 EUR minor units"),
        error("out_of_stock", "trench-sand-s is sold out"),
        error("out_of_stock", "trench-sand-m is sold out"),
        error("new_code", "A message the widget has no words for"),
        { type: "info", code: "note", content: "Not an error" },
      ],
    });
    expect(bag.codes).toContain("spend_limit_exceeded");
    expect(bag.problems).toEqual([
      "Something in your bag has just sold out. Remove it to go on.",
      "A message the widget has no words for",
    ]);
  });
});

describe("choosing a variant", () => {
  test("an unset option takes the first variant's value; a full choice names one variant", () => {
    expect(variantFor(TRENCH, {})?.id).toBe("trench-sand-s");
    expect(variantFor(TRENCH, { size: "M" })?.id).toBe("trench-sand-m");
    expect(variantFor(TRENCH, { colour: "navy", size: "S" })?.id).toBe("trench-navy-s");
  });

  test("a pill that leads only to a sold-out or missing variant is not offered", () => {
    expect(offered(TRENCH, { size: "M" }, "colour", "navy")).toBe(false);
    expect(offered(TRENCH, { size: "S" }, "colour", "navy")).toBe(true);
    expect(offered(TRENCH, { colour: "navy" }, "size", "M")).toBe(false);
  });
});

describe('"By hand" calls', () => {
  test("search sends the query and the cursor only", () => {
    expect(searchCall("  linen  ", "c2")).toEqual({
      name: "search_catalog",
      arguments: { catalog: { query: "linen", pagination: { cursor: "c2" } } },
    });
  });

  test("the first add starts a cart; the next ones extend it, at most 10 of a line", () => {
    expect(addCall(undefined, "socks", KEY)).toEqual({
      name: "create_cart",
      arguments: {
        meta: { "idempotency-key": KEY },
        cart: { line_items: [{ item: { id: "socks" }, quantity: 1 }] },
      },
    });
    const next = addCall(cart([line("socks", 10, 1200)]), "socks", KEY);
    expect(next.name).toBe("update_cart");
    expect(next.arguments.cart).toEqual({ line_items: [{ item: { id: "socks" }, quantity: 10 }] });
    expect(addCall(cart(), "beanie", KEY).arguments.cart).toEqual({
      line_items: [
        { item: { id: "socks" }, quantity: 1 },
        { item: { id: "beanie" }, quantity: 1 },
      ],
    });
  });

  test("quantities change on a cart or an open checkout; the last line is never removed", () => {
    expect(quantityCall(cart(), "socks", 0, KEY)).toBeUndefined();
    expect(quantityCall(checkout(), "socks", 3, KEY)).toEqual({
      name: "update_checkout",
      arguments: {
        meta: { "idempotency-key": KEY },
        id: "chk_1",
        checkout: { line_items: [{ item: { id: "socks" }, quantity: 3 }] },
      },
    });
    expect(quantityCall(checkout("completed"), "socks", 3, KEY)).toBeUndefined();
  });

  test("pay names only a card the checkout listed, only when it is ready", () => {
    expect(payCall(checkout(), "alias_visa", KEY)).toEqual({
      name: "complete_checkout",
      arguments: {
        meta: { "idempotency-key": KEY },
        id: "chk_1",
        checkout: {
          payment: {
            instruments: [
              { id: "alias_visa", handler_id: "saved_card", type: "card", selected: true },
            ],
          },
        },
      },
    });
    expect(payCall(checkout(), "someone_elses_card", KEY)).toBeUndefined();
    expect(payCall(checkout("requires_escalation"), "alias_visa", KEY)).toBeUndefined();
    expect(payCall(cart(), "alias_visa", KEY)).toBeUndefined();
  });
});

describe("the two modes", () => {
  test('"With the assistant" never makes a tool call, whatever the button', () => {
    let built = 0;
    const call = () => {
      built++;
      return searchCall("x");
    };
    const action = choose("assistant", "Searching", call, () => say.search("linen shirts"));
    expect(action).toEqual({ kind: "say", text: "Show me linen shirts from Atelier Velune." });
    expect(built).toBe(0);
    expect(choose("hand", "Searching", call, () => "unused")).toEqual({
      kind: "call",
      label: "Searching",
      call: searchCall("x"),
    });
    expect(
      choose(
        "hand",
        "Paying",
        () => undefined,
        () => "unused",
      ),
    ).toEqual({ kind: "none" });
  });

  test("the sentences name what the shopper chose, and a by-hand change names its cart", () => {
    const v = variantFor(TRENCH, { colour: "sand", size: "M" })!;
    expect(say.add(TRENCH, v)).toBe("Add the Trench coat in Sand, size M to my bag.");
    expect(say.pay(checkout().instruments[0]!, "€16.95")).toBe(
      "Pay €16.95 for my bag with my saved card Visa •••• 1111 · 03/30.",
    );
    expect(contextFor(cart())).toContain("cart crt_1");
  });
});

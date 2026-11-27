// The first-order welcome offer (ADR-020): 5 % off and a free seasonal tote, asked for, priced on
// the server, granted to an account with no order and checked again before paying.
// Spec: knowledge/components/agentic-storefront.md
import { beforeEach, describe, expect, test } from "bun:test";
import { handle } from "../api";
import { seasonFor } from "../../lib/seasons";
import { get, list } from "../core/db";
import { fake } from "../testing/fake-adyen";
import { freshStore, ORIGIN, randomIp, signUpCustomer } from "../testing/agent";
import { ucpAgent } from "../testing/platform";
import { renderOrder } from "../ucp/ucp";
import * as commerce from "./commerce";

// 35.00 and 65.00: exactly 100.00, the free standard delivery threshold.
const HUNDRED = [
  { variantId: "velune-card-holder-cognac-one-size", quantity: 1 },
  { variantId: "velune-silk-scarf-terracotta-one-size", quantity: 1 },
];
const SOCKS = [{ variantId: "velune-rib-socks-oat-one-size", quantity: 1 }];

type Call = { body?: unknown; cookie?: string };
async function call(method: string, path: string, opts: Call = {}) {
  const response = await handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        "x-forwarded-for": randomIp(),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await response.text();
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* an empty or plain answer */
  }
  return { status: response.status, body };
}

// An anonymous agent creating a checkout over UCP REST.
async function ucpCreate(lineItems: unknown[]) {
  const response = await handle(
    new Request(`${ORIGIN}/ucp/v1/checkout-sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ucp-agent": ucpAgent(),
        "request-id": crypto.randomUUID(),
        "idempotency-key": crypto.randomUUID(),
        "x-forwarded-for": randomIp(),
      },
      body: JSON.stringify({ line_items: lineItems }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const guestCheckout = async (lines = HUNDRED) =>
  (await call("POST", "/api/checkouts", { body: { lines } })).body.id as string;
const claim = (id: string, cookie?: string, body: unknown = { applyWelcomeOffer: true }) =>
  call("POST", `/api/checkouts/${id}/claim`, { cookie, body });

async function pay(id: string, cookie: string) {
  const session = await call("POST", `/api/checkouts/${id}/session`, { cookie });
  expect(session.status).toBe(200);
  fake.session = {
    status: "completed",
    payments: [{ resultCode: "Authorised", pspReference: `PSP${id.slice(-6)}` }],
  };
  await commerce.finishShopperSession(
    get<commerce.Checkout>("checkouts", id)!,
    session.body.id as string,
    "r",
  );
  return session.body;
}

beforeEach(() => freshStore());

describe("welcome offer", () => {
  test("a new account's claim takes 5 % off the items, adds the tote and charges the discounted total", async () => {
    const { cookie, email } = await signUpCustomer();
    const id = await guestCheckout();
    const claimed = await claim(id, cookie);
    expect(claimed.status).toBe(200);
    expect(claimed.body.welcomeOfferApplied).toBe(true);
    const season = seasonFor();
    expect(claimed.body.welcomeOffer).toEqual({
      ratePercent: 5,
      seasonId: season.id,
      giftVariantId: season.giftVariantId,
      giftTitle: season.giftTitle,
    });
    expect(claimed.body.buyer.email).toBe(email);
    // Free delivery is judged on the 100.00 before the discount.
    expect([claimed.body.subtotal, claimed.body.discount]).toEqual([10000, 500]);
    expect([claimed.body.fulfillment, claimed.body.total]).toEqual([0, 9500]);
    expect(claimed.body.gift).toMatchObject({
      variantId: season.giftVariantId,
      title: season.giftTitle,
      unitPrice: 0,
      amount: 0,
    });
    expect(claimed.body.lines).toHaveLength(2);

    const session = await pay(id, cookie);
    expect(session.amount).toBe(9500);
    expect(fake.sessions.at(-1)!.amount).toBe(9500);
    const orders = list<commerce.Order>("orders");
    expect(orders).toHaveLength(1);
    const order = orders[0]!;
    expect([order.subtotal, order.discount, order.fulfillment, order.total]).toEqual([
      10000, 500, 0, 9500,
    ]);
    expect(order.welcomeOffer?.giftTitle).toBe(season.giftTitle);
    const rendered = renderOrder(order, true);
    expect(rendered.totals).toContainEqual({
      type: "discount",
      display_text: "Welcome offer (-5%)",
      amount: -500,
    });
    expect(rendered.line_items.map((l) => l.item.id)).toContain(season.giftVariantId);
    const account = await call("GET", "/api/account", { cookie });
    expect(account.body.firstOrderEligible).toBe(false);
    expect(account.body.orders[0]).toMatchObject({ total: 9500, discount: 500 });
  });

  test("under 100.00 the discount comes off the items and delivery is still charged", async () => {
    const { cookie } = await signUpCustomer();
    const id = await guestCheckout(SOCKS);
    const claimed = await claim(id, cookie);
    expect([claimed.body.subtotal, claimed.body.discount]).toEqual([1200, 60]);
    expect([claimed.body.fulfillment, claimed.body.total]).toEqual([495, 1635]);
  });

  test("without asking, no offer: the claim binds the account and the prices stay the catalogue's", async () => {
    const { cookie, email } = await signUpCustomer();
    const id = await guestCheckout();
    const before = await call("GET", `/api/checkouts/${id}`, { cookie });
    // A signed-in shopper looking at a guest's bag with no order yet may still ask for it.
    expect(before.body.welcomeOfferAvailable).toBe(true);
    const claimed = await claim(id, cookie, {});
    expect(claimed.status).toBe(200);
    expect(claimed.body.welcomeOfferApplied).toBe(false);
    expect([claimed.body.discount, claimed.body.total, claimed.body.gift]).toEqual([
      0,
      10000,
      undefined,
    ]);
    expect(claimed.body.buyer.email).toBe(email);
    expect(claimed.body.welcomeOfferAvailable).toBe(true);
    // A UCP checkout without the offer keeps its three totals.
    const created = await ucpCreate([{ item: { id: SOCKS[0]!.variantId }, quantity: 1 }]);
    expect(created.status).toBe(201);
    expect(created.body.totals.map((t: { type: string }) => t.type)).toEqual([
      "subtotal",
      "fulfillment",
      "total",
    ]);
  });

  test("an account that has ordered gets no offer again", async () => {
    const { cookie } = await signUpCustomer();
    const first = await guestCheckout();
    await claim(first, cookie);
    await pay(first, cookie);
    const second = await guestCheckout();
    const claimed = await claim(second, cookie);
    expect(claimed.status).toBe(200);
    expect(claimed.body.welcomeOfferApplied).toBe(false);
    expect([claimed.body.discount, claimed.body.total, claimed.body.gift]).toEqual([
      0,
      10000,
      undefined,
    ]);
    const created = await call("POST", "/api/checkouts", {
      cookie,
      body: { lines: HUNDRED, applyWelcomeOffer: true },
    });
    const view = await call("GET", `/api/checkouts/${created.body.id}`, { cookie });
    expect([view.body.discount, view.body.total]).toEqual([0, 10000]);
  });

  test("two tabs cannot both use the offer: the second payment session refuses and removes it", async () => {
    const { cookie } = await signUpCustomer();
    const a = await guestCheckout();
    const b = await guestCheckout();
    expect((await claim(a, cookie)).body.welcomeOfferApplied).toBe(true);
    expect((await claim(b, cookie)).body.welcomeOfferApplied).toBe(true);
    await pay(a, cookie);
    const sessions = fake.sessions.length;
    const refused = await call("POST", `/api/checkouts/${b}/session`, { cookie });
    expect([refused.status, refused.body.code]).toEqual([409, "welcome_offer_ineligible"]);
    expect(fake.sessions).toHaveLength(sessions);
    const view = await call("GET", `/api/checkouts/${b}`, { cookie });
    expect([view.body.welcomeOffer, view.body.discount, view.body.total]).toEqual([
      undefined,
      0,
      10000,
    ]);
    expect((await call("POST", `/api/checkouts/${b}/session`, { cookie })).body.amount).toBe(10000);
  });

  test("the claim needs a session, the checkout's own account and a body with the flag only", async () => {
    const ada = await signUpCustomer();
    const bob = await signUpCustomer();
    const id = await guestCheckout();
    const anonymous = await claim(id);
    expect([anonymous.status, anonymous.body.code]).toEqual([401, "sign_in_required"]);
    expect((await claim(id, ada.cookie, { applyWelcomeOffer: "yes" })).status).toBe(400);
    expect((await claim(id, ada.cookie, { applyWelcomeOffer: true, total: 1 })).status).toBe(400);
    expect((await claim(id, ada.cookie)).status).toBe(200);
    const stolen = await claim(id, bob.cookie);
    expect([stolen.status, stolen.body.code]).toEqual([404, "not_found"]);
    const view = await call("GET", `/api/checkouts/${id}`, { cookie: ada.cookie });
    expect(view.body.buyer.email).toBe(ada.email);
  });

  test("the tote is no item: an order naming it is refused, and an update that sends it back keeps it", async () => {
    const gift = seasonFor().giftVariantId;
    const web = await call("POST", "/api/checkouts", {
      body: { lines: [{ variantId: gift, quantity: 1 }] },
    });
    expect([web.status, web.body.code]).toEqual([400, "item_not_found"]);
    const ucp = await ucpCreate([{ item: { id: gift }, quantity: 1 }]);
    expect(ucp.status).toBe(400);
    expect(JSON.stringify(ucp.body)).toContain("item_not_found");

    const { cookie } = await signUpCustomer();
    const id = await guestCheckout();
    await claim(id, cookie);
    const checkout = get<commerce.Checkout>("checkouts", id)!;
    const updated = commerce.updateCheckout(checkout, {
      line_items: [
        { item: { id: HUNDRED[0]!.variantId }, quantity: 2 },
        { id: commerce.GIFT_LINE_ID, item: { id: gift }, quantity: 1 },
      ],
    });
    expect(updated.lines.map((l) => [l.variantId, l.quantity])).toEqual([
      [HUNDRED[0]!.variantId, 2],
    ]);
    expect(updated.welcomeOffer?.giftVariantId).toBe(gift);
  });

  test("the tote's four pictures are served and any other gift name is 404", async () => {
    for (const season of ["winter", "spring", "summer", "autumn"]) {
      const response = await handle(
        new Request(`${ORIGIN}/api/art/velune-welcome-tote-${season}.svg`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
      const svg = await response.text();
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain(season.toUpperCase());
    }
    for (const name of ["velune-welcome-tote-bogus", "velune-welcome-tote-winter-x"]) {
      const response = await handle(new Request(`${ORIGIN}/api/art/${name}.svg`));
      expect(response.status).toBe(404);
    }
  });
});

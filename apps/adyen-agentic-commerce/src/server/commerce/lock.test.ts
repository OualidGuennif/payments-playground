// One payment at a time per checkout across the shopper's Drop-in and an agent's complete: claims
// race, edits and cancels wait, a changed bag reloads the form, and a result or refusal frees it.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as commerce from "./commerce";
import { customerById } from "../accounts/customers";
import { handle } from "../api";
import { list } from "../core/db";
import { type Auth, authenticate, grants } from "../oauth/oauth";
import { freshStore, ORIGIN, randomIp, signUpCustomer, TestAgent } from "../testing/agent";
import { fake } from "../testing/fake-adyen";

const SOCKS = "velune-rib-socks-oat-one-size"; // 1200 + 495 shipping
const OXFORD = "velune-oxford-shirt-white-s";
const items = (...ids: string[]) => ids.map((id) => ({ item: { id }, quantity: 1 }));
const nextYear = new Date().getUTCFullYear() + 1;
// A guest agent pays with its own network token: no grant, no budget, the shortest agent path.
const agentPays = {
  payment: {
    instruments: [
      {
        id: "nt_1",
        handler_id: "network_token",
        credential: {
          type: "network_token",
          number: "4111111111111111",
          expiry_month: 8,
          expiry_year: nextYear,
        },
      },
    ],
  },
};

beforeEach(() => freshStore());

// An agent's checkout the shopper opened at its link, with a Drop-in session started there.
async function openedOnTheWeb() {
  const checkout = commerce.createCheckout({
    line_items: items(SOCKS),
    buyer: { email: "a@example.com" },
  });
  const session = await commerce.startShopperSession(checkout);
  return { checkout, session };
}

const reload = (id: string) => commerce.loadCheckout(id, "browser");
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as commerce.CommerceError).msg.code;
  }
  return "passed";
};

describe("payment lock", () => {
  test("a Drop-in claim holds the checkout; the agent's complete then sends nothing", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    const answered = await commerce.completeCheckout(reload(checkout.id), agentPays);
    expect(fake.payments).toHaveLength(0);
    expect(answered.phase).toBe("open");
    const seen = commerce.assess(reload(checkout.id), undefined, []);
    expect(seen.status).toBe("complete_in_progress");
    expect(seen.messages.map((m) => m.code)).toContain("payment_in_progress");
  });

  test("an agent that paid first makes the Drop-in claim refuse", async () => {
    const { checkout, session } = await openedOnTheWeb();
    await commerce.completeCheckout(reload(checkout.id), agentPays);
    expect(fake.payments).toHaveLength(1);
    expect(codeOf(() => commerce.claimWebPayment(checkout.id, session.id))).toBe(
      "payment_in_progress",
    );
  });

  test("the agent's claim and the Drop-in claim race: one payment, the other refused", async () => {
    const { checkout, session } = await openedOnTheWeb();
    let web = "not run";
    // The Drop-in claim lands while the agent's card brand lookup is in flight.
    const brand = fake.cardBrand.bind(fake);
    fake.cardBrand = (number: string) => {
      web = codeOf(() => commerce.claimWebPayment(checkout.id, session.id));
      return brand(number);
    };
    await commerce.completeCheckout(reload(checkout.id), agentPays);
    fake.cardBrand = brand;
    expect(web).toBe("passed");
    expect(fake.payments).toHaveLength(0);
  });

  test("two Drop-in tabs: no second session while the first holds, and the first may retry", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    const attempts = reload(checkout.id).attempts;
    let second = "passed";
    try {
      await commerce.startShopperSession(reload(checkout.id));
    } catch (error) {
      second = (error as commerce.CommerceError).msg.code;
    }
    expect(second).toBe("payment_in_progress");
    // The first payment's attempt stands, so its refusal still reopens the checkout and its form
    // may still retry.
    expect(reload(checkout.id).attempts).toBe(attempts);
    expect(codeOf(() => commerce.claimWebPayment(checkout.id, session.id))).toBe("passed");
  });

  test("the same session may claim again (a retry after a refused card in the form)", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    expect(codeOf(() => commerce.claimWebPayment(checkout.id, session.id))).toBe("passed");
  });

  test("edits and cancels wait while a payment holds the checkout", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    expect(
      codeOf(() =>
        commerce.updateCheckout(reload(checkout.id), { line_items: items(SOCKS, OXFORD) }),
      ),
    ).toBe("payment_in_progress");
    expect(codeOf(() => commerce.cancelCheckout(reload(checkout.id)))).toBe("payment_in_progress");
  });

  test("a bag changed after the form opened reloads it instead of paying the old bag", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.updateCheckout(reload(checkout.id), { line_items: items(SOCKS, OXFORD) });
    expect(codeOf(() => commerce.claimWebPayment(checkout.id, session.id))).toBe(
      "checkout_changed",
    );
    expect(reload(checkout.id).paying).toBeUndefined();
  });

  test("an unknown session or checkout claims nothing", async () => {
    const { checkout } = await openedOnTheWeb();
    expect(codeOf(() => commerce.claimWebPayment(checkout.id, "CS_forged"))).toBe("not_found");
    expect(codeOf(() => commerce.claimWebPayment("chk_none", "CS_forged"))).toBe("not_found");
  });

  test("a refused Drop-in result frees the checkout for the agent", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    fake.session = { status: "refused", payments: [{ resultCode: "Refused" }] };
    await commerce.finishShopperSession(reload(checkout.id), session.id, "r");
    expect(reload(checkout.id).paying).toBeUndefined();
    await commerce.completeCheckout(reload(checkout.id), agentPays);
    expect(fake.payments).toHaveLength(1);
  });

  test("a refusal webhook frees the checkout; another payment's hold stays", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    const reference = `${checkout.id}-s1`;
    commerce.applyNotification({
      eventCode: "AUTHORISATION",
      success: "false",
      merchantReference: `${checkout.id}-s0`,
    } as never);
    expect(reload(checkout.id).paying?.reference).toBe(reference);
    commerce.applyNotification({
      eventCode: "AUTHORISATION",
      success: "false",
      merchantReference: reference,
      pspReference: "PSPREFUSED",
    } as never);
    expect(reload(checkout.id).paying).toBeUndefined();
  });

  test("an Authorised result places one order and clears the hold", async () => {
    const { checkout, session } = await openedOnTheWeb();
    commerce.claimWebPayment(checkout.id, session.id);
    fake.session = {
      status: "completed",
      payments: [{ resultCode: "Authorised", pspReference: "PSPWEB" }],
    };
    await commerce.finishShopperSession(reload(checkout.id), session.id, "r");
    const done = reload(checkout.id);
    expect(done.phase).toBe("completed");
    expect(done.paying).toBeUndefined();
    expect(list<commerce.Order>("orders")).toHaveLength(1);
  });

  test("a hold past its time holds nothing", async () => {
    const { checkout, session } = await openedOnTheWeb();
    const at = Date.now();
    commerce.claimWebPayment(checkout.id, session.id, at);
    const later = at + commerce.PAYING_MS + 1;
    expect(commerce.payingNow(reload(checkout.id), later)).toBeUndefined();
    expect(commerce.payingNow(reload(checkout.id), at + 1000)).toBeDefined();
  });
});

describe("POST /api/checkouts/:id/pay-intent", () => {
  const payIntent = async (id: string, body: unknown) => {
    const response = await handle(
      new Request(`${ORIGIN}/api/checkouts/${id}/pay-intent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomIp() },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  test("holds for the form's session and names the refusal's code for another", async () => {
    // Two tabs opened the form before either paid; the newer session pays first.
    const { checkout, session } = await openedOnTheWeb();
    const second = await commerce.startShopperSession(reload(checkout.id));
    const held = await payIntent(checkout.id, { sessionId: second.id });
    expect(held.status).toBe(200);
    expect(held.body.held).toBe(true);
    const refused = await payIntent(checkout.id, { sessionId: session.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("payment_in_progress");
  });

  test("a missing or forged session holds nothing", async () => {
    const { checkout } = await openedOnTheWeb();
    expect((await payIntent(checkout.id, {})).status).toBe(404);
    expect((await payIntent(checkout.id, { sessionId: 42 })).status).toBe(404);
    expect(reload(checkout.id).paying).toBeUndefined();
  });
});

describe("one payment at a time per account", () => {
  let agent: TestAgent;
  beforeAll(async () => {
    agent = await TestAgent.start("Lock agent");
  });
  afterAll(() => agent.stop());

  const savedCard = {
    payment: { instruments: [{ id: commerce.cardAlias("TEST_STORED_VISA_1111") }] },
  };

  test("a Drop-in hold on one checkout stops the account's agent paying another", async () => {
    agent.ip = randomIp();
    await agent.signIn();
    const auth = authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth;
    const customer = customerById(grants()[0]!.customerId)!;
    const theirs = commerce.createCheckout({ line_items: items(SOCKS) }, auth);
    const web = commerce.createCheckout({ line_items: items(OXFORD) }, undefined, { customer });
    const session = await commerce.startShopperSession(web, customer);
    commerce.claimWebPayment(web.id, session.id);
    await expect(
      commerce.completeCheckout(commerce.loadCheckout(theirs.id, auth), savedCard, auth),
    ).rejects.toThrow("already in progress");
    expect(fake.payments).toHaveLength(0);
  });

  test("a guest bag the signed-in shopper is paying stops the account's other payments", async () => {
    agent.ip = randomIp();
    await agent.signIn();
    const auth = authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth;
    const customer = customerById(grants()[0]!.customerId)!;
    const theirs = commerce.createCheckout({ line_items: items(SOCKS) }, auth);
    // A bag opened as a guest, then paid from a tab where the shopper has signed in since.
    const { checkout: guest, session } = await openedOnTheWeb();
    commerce.claimWebPayment(guest.id, session.id, Date.now(), customer.id);
    expect(commerce.accountPaying(customer.id, theirs.id)).toBe(true);
    await expect(
      commerce.completeCheckout(commerce.loadCheckout(theirs.id, auth), savedCard, auth),
    ).rejects.toThrow("already in progress");
    expect(fake.payments).toHaveLength(0);
    // The hold ends with its payment: released, it stops nothing.
    commerce.releasePayment(guest.id, `${guest.id}-s1`);
    expect(commerce.accountPaying(customer.id, theirs.id)).toBe(false);
  });

  test("the signed-in payer's pending Drop-in payment on a guest bag still holds the account", async () => {
    agent.ip = randomIp();
    await agent.signIn();
    const customer = customerById(grants()[0]!.customerId)!;
    const own = commerce.createCheckout({ line_items: items(OXFORD) }, undefined, { customer });
    const ownSession = await commerce.startShopperSession(own, customer);
    const { checkout: guest, session } = await openedOnTheWeb();
    commerce.claimWebPayment(guest.id, session.id, Date.now(), customer.id);
    // Adyen keeps the guest bag's payment pending: the hold is gone, the payment is not.
    fake.session = { status: "paymentPending", payments: [] };
    await commerce.finishShopperSession(reload(guest.id), session.id, "r");
    expect(reload(guest.id).phase).toBe("complete_in_progress");
    expect(codeOf(() => commerce.claimWebPayment(own.id, ownSession.id))).toBe(
      "payment_in_progress",
    );
  });

  test("an agent paying for the account stops a Drop-in claim on another checkout", async () => {
    agent.ip = randomIp();
    await agent.signIn();
    const auth = authenticate(`Bearer ${agent.accessToken}`, "/mcp") as Auth;
    const customer = customerById(grants()[0]!.customerId)!;
    const web = commerce.createCheckout({ line_items: items(OXFORD) }, undefined, { customer });
    const session = await commerce.startShopperSession(web, customer);
    const theirs = commerce.createCheckout({ line_items: items(SOCKS) }, auth);
    // Adyen keeps the agent's payment pending, so it stays in progress.
    fake.answers.push({ resultCode: "Pending", pspReference: "PSPPENDING" });
    await commerce.completeCheckout(commerce.loadCheckout(theirs.id, auth), savedCard, auth);
    expect(codeOf(() => commerce.claimWebPayment(web.id, session.id))).toBe("payment_in_progress");
    expect(commerce.accountPaying(customer.id, web.id)).toBe(true);
    expect(commerce.accountPaying(customer.id, web.id, Date.now() + commerce.PAYING_MS + 1)).toBe(
      false,
    );
  });
});

describe("POST /api/checkouts/:id/lines", () => {
  const post = async (id: string, body: unknown, cookie?: string) => {
    const response = await handle(
      new Request(`${ORIGIN}/api/checkouts/${id}/lines`, {
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
  const bag = [
    { variantId: SOCKS, quantity: 1 },
    { variantId: OXFORD, quantity: 1 },
  ];

  test("a site checkout takes the bag's lines until a payment holds it", async () => {
    const web = commerce.createCheckout(
      { line_items: items(SOCKS), buyer: { email: "a@example.com" } },
      undefined,
      {},
    );
    const taken = await post(web.id, { lines: bag });
    expect(taken.status).toBe(200);
    expect((taken.body.lines as unknown[]).length).toBe(2);
    const session = await commerce.startShopperSession(reload(web.id));
    commerce.claimWebPayment(web.id, session.id);
    const held = await post(web.id, { lines: [{ variantId: SOCKS, quantity: 2 }] });
    expect(held.status).toBe(409);
    expect(held.body.code).toBe("payment_in_progress");
  });

  test("an agent's checkout, another account's or a bad bag changes nothing", async () => {
    const { checkout } = await openedOnTheWeb();
    expect((await post(checkout.id, { lines: bag })).status).toBe(404);
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
    const id = ((await created.json()) as { id: string }).id;
    expect((await post(id, { lines: bag }, someone.cookie)).status).toBe(404);
    expect((await post(id, { lines: [] }, owner.cookie)).status).toBe(400);
    expect(
      (await post(id, { lines: [{ variantId: "nope", quantity: 1 }] }, owner.cookie)).status,
    ).toBe(400);
    expect((await post(id, { lines: bag }, owner.cookie)).status).toBe(200);
  });
});

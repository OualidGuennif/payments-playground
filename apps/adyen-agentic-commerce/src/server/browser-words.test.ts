// Spec: knowledge/components/adyen-agentic-commerce.md
// The store's browser routes speak to a person: plain sentences, never the texts written for
// agents (which name fields), and the signed-in shopper's own email offered for a receipt.
import { beforeEach, describe, expect, test } from "bun:test";
import { shopperWords } from "../lib/shopper-words";
import { handle } from "./api";
import * as commerce from "./commerce/commerce";
import { freshStore, ORIGIN, randomIp, signUpCustomer } from "./testing/agent";

const SOCKS = "velune-rib-socks-oat-one-size";
const items = [{ item: { id: SOCKS }, quantity: 1 }];

beforeEach(() => freshStore());

async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const response = await handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": randomIp(),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

type Message = { code: string; content: string };

describe("browser routes in plain words", () => {
  test("a checkout missing its email reads as a sentence, not a field name", async () => {
    const checkout = commerce.createCheckout({ line_items: items });
    const view = await call("GET", `/api/checkouts/${checkout.id}`);
    const messages = view.body.messages as Message[];
    expect(messages.map((m) => m.code)).toContain("missing_buyer_email");
    for (const m of messages) expect(m.content).toBe(shopperWords(m.code));
    // `path` stays for code; the words a person reads name no field.
    for (const m of messages) expect(m.content).not.toMatch(/buyer|\$\.|_/);
  });

  test("a refusal carries the shopper's sentence and the code the page acts on", async () => {
    const missing = await call("GET", "/api/checkouts/chk_nope");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: shopperWords("not_found"), code: "not_found" });

    const checkout = commerce.createCheckout({ line_items: items });
    const bad = await call("POST", `/api/checkouts/${checkout.id}/email`, { email: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe(shopperWords("invalid_email"));
    const path = `/api/checkouts/${checkout.id}/email`;
    expect((await call("POST", path, { email: "a@example.com" })).status).toBe(200);
    const again = await call("POST", path, { email: "b@example.com" });
    expect(again.body).toEqual({ error: shopperWords("email_set"), code: "email_set" });
  });

  test("the signed-in shopper is offered their own email; nobody else's", async () => {
    const guest = commerce.createCheckout({ line_items: items });
    const owner = await signUpCustomer();
    const someone = await signUpCustomer();

    const signedOut = await call("GET", `/api/checkouts/${guest.id}`);
    expect(signedOut.body.signedIn).toBe(false);
    expect(signedOut.body.accountEmail).toBeUndefined();

    const signedIn = await call("GET", `/api/checkouts/${guest.id}`, undefined, owner.cookie);
    expect(signedIn.body.signedIn).toBe(true);
    expect(signedIn.body.accountEmail).toBe(owner.email);

    const bag = { lines: [{ variantId: SOCKS, quantity: 1 }], email: owner.email };
    const created = await call("POST", "/api/checkouts", bag, owner.cookie);
    const theirs = await call(
      "GET",
      `/api/checkouts/${created.body.id}`,
      undefined,
      someone.cookie,
    );
    expect(theirs.body.signedIn).toBe(true);
    expect(theirs.body.accountEmail).toBeUndefined();
    expect(theirs.body.buyer).toBeUndefined();
  });
});

// Spec: knowledge/components/agentic-storefront.md
import { describe, expect, test } from "bun:test";
import { CARD_BRANDS } from "../../lib/payment-methods";
import { ORDER_PAYMENT_METHODS, type SessionRequest, sessionRequest } from "./adyen";

const order: SessionRequest = {
  amount: 18900,
  reference: "chk_test-a1",
  returnUrl: "http://127.0.0.1:8003/api/return",
  purpose: "order",
  metadata: {},
};

describe("the payment session request", () => {
  test("an order lists exactly the store's methods, Cartes Bancaires first", () => {
    const body = sessionRequest(order, "FakeMerchantECOM");
    expect(body.allowedPaymentMethods).toEqual([
      "cartebancaire",
      "visa",
      "mc",
      "amex",
      "applepay",
      "googlepay",
      "klarna",
      "klarna_account",
      "klarna_paynow",
      "paypal",
      "wero",
      "mbway",
      "bizum",
      "pix",
    ]);
    expect(CARD_BRANDS).toEqual(["cartebancaire", "visa", "mc", "amex"]);
    // "scheme" would let in every card brand the merchant account has.
    expect(body.allowedPaymentMethods).not.toContain("scheme");
    // A copy: a caller changing one request never changes the next one's list.
    expect(body.allowedPaymentMethods).not.toBe(ORDER_PAYMENT_METHODS);
    expect(body.countryCode).toBe("FR");
    expect(body.amount).toEqual({ currency: "EUR", value: 18900 });
    // Klarna needs line items that add up to the amount.
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems?.[0]).toMatchObject({ quantity: 1, amountIncludingTax: 18900 });
  });

  test("a guest's order names no shopper and can keep no card", () => {
    const body = sessionRequest({ ...order, shopperEmail: "guest@example.test" }, "M");
    expect(body.shopperReference).toBeUndefined();
    expect(body.storePaymentMethodMode).toBeUndefined();
    expect(body.recurringProcessingModel).toBeUndefined();
  });

  test("an account's order keeps a card only when the shopper ticks the box", () => {
    const body = sessionRequest({ ...order, shopperReference: "cus_1" }, "M");
    expect(String(body.storePaymentMethodMode)).toBe("askForConsent");
    expect(String(body.recurringProcessingModel)).toBe("CardOnFile");
    expect(body.allowedPaymentMethods).toEqual([...ORDER_PAYMENT_METHODS]);
  });

  test("a card save lists the four card brands alone, stores it, and needs an account", () => {
    const save: SessionRequest = { ...order, amount: 0, purpose: "card-save" };
    const body = sessionRequest({ ...save, shopperReference: "cus_1" }, "M");
    expect(body.allowedPaymentMethods).toEqual([...CARD_BRANDS]);
    expect(body.lineItems).toBeUndefined();
    expect(String(body.storePaymentMethodMode)).toBe("enabled");
    expect(String(body.recurringProcessingModel)).toBe("UnscheduledCardOnFile");
    expect(() => sessionRequest(save, "M")).toThrow("A card is saved only to an account");
  });
});

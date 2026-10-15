import type { Address, Amount } from "./types.ts";

// A single always-fake TEST inbox, mirroring the legacy playground so every
// app's session/payment requests carry the same shopper-identity shape.
export const DEFAULT_DUMMY_SHOPPER_EMAIL = "test456789767545678@gmail.com";

export function resolveShopperEmail(email?: unknown): string {
  return String(email || DEFAULT_DUMMY_SHOPPER_EMAIL).trim().toLowerCase();
}

// Adyen requires lineItems to be present (and to sum to the order amount)
// for line-item-aware methods like Klarna and other BNPL/pay-later methods
// to be considered eligible at all, without it they're silently excluded
// from a session's paymentMethods, even though a bare /paymentMethods call
// (which doesn't need lineItems) still lists them.
export function buildLineItems(
  amount: Amount,
  description = "Playground order",
): Array<Record<string, unknown>> {
  return [{
    id: "1",
    quantity: 1,
    description,
    amountIncludingTax: amount.value,
    amountExcludingTax: amount.value,
    taxAmount: 0,
    itemCategory: "PHYSICAL_GOODS",
  }];
}

export function addressesAreEqual(a: Address, b: Address): boolean {
  return a.street === b.street &&
    a.houseNumberOrName === b.houseNumberOrName &&
    a.postalCode === b.postalCode &&
    a.city === b.city &&
    a.country === b.country;
}

const SPLIT_CARD_FUNDING_COUNTRIES = new Set(["BR", "MX", "FI"]);

/**
 * Markets where Adyen returns debit and credit cards as separate payment
 * methods. Needed on /paymentMethods as well as /sessions, without it the
 * Advanced flow gets a single merged "Cards" entry on those markets.
 */
export function splitsCardFundingSources(countryCode: string): boolean {
  return SPLIT_CARD_FUNDING_COUNTRIES.has(countryCode.toUpperCase());
}

/**
 * The risk/context fields the legacy playground's adyenService.js always
 * sent, common to both /sessions and /payments, shopperInteraction,
 * shopperName, telephoneNumber, riskdata, 3DS preference and accountInfo.
 * Centralized here so every app's Adyen request stays aligned without
 * copy-pasting this block into each api.ts.
 *
 * The Sessions and Payments (Checkout) APIs accept different field sets ,
 * each rejects unknown fields outright rather than ignoring them, so
 * `splitCardFundingSources` (sessions-only) and `merchantRiskIndicator`
 * (payments-only) are added by `sessionRiskFields()`/`paymentsRiskFields()`
 * respectively rather than living in this shared base.
 */
function commonRiskFields(nativeThreeDS: boolean): Record<string, unknown> {
  return {
    shopperInteraction: "Ecommerce",
    shopperName: { firstName: "Test", lastName: "Shopper" },
    telephoneNumber: "+33612341212",
    additionalData: {
      "riskdata.isGuest": "true",
      "riskdata.loyaltyPoints": "237",
    },
    // "disabled" makes the 3DS2 challenge a redirect to the issuer's page
    // instead of rendering inside the checkout; merchants ask to see both.
    authenticationData: {
      threeDSRequestData: { nativeThreeDS: nativeThreeDS ? "preferred" : "disabled" },
    },
    accountInfo: {
      accountAgeIndicator: "from30To60Days",
      accountChangeIndicator: "lessThan30Days",
      deliveryAddressUsageIndicator: "thisTransaction",
    },
  };
}

/** For /sessions requests: common fields plus splitCardFundingSources. */
export function sessionRiskFields(
  countryCode: string,
  nativeThreeDS = true,
): Record<string, unknown> {
  return {
    ...commonRiskFields(nativeThreeDS),
    splitCardFundingSources: SPLIT_CARD_FUNDING_COUNTRIES.has(countryCode.toUpperCase()),
  };
}

/** For /payments requests: common fields plus merchantRiskIndicator. */
export function paymentsRiskFields(
  billingAddress: Address,
  deliveryAddress: Address,
  nativeThreeDS = true,
): Record<string, unknown> {
  const addressMatch = addressesAreEqual(billingAddress, deliveryAddress);
  return {
    ...commonRiskFields(nativeThreeDS),
    merchantRiskIndicator: {
      addressMatch,
      deliveryAddressIndicator: addressMatch ? "shipToBillingAddress" : "shipToNewAddress",
      deliveryTimeframe: "twoOrMoreDaysShipping",
    },
  };
}

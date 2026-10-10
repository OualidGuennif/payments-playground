/**
 * Adyen TEST credentials shown next to the checkouts: published test card
 * numbers and alternative-method sample data, nothing that works on LIVE.
 * Shared so styling and digital show the same values.
 */

export interface TestCard {
  scheme: string;
  note?: string;
  pan: string;
  expiry: string;
  cvc: string;
}

export const TEST_CARDS: TestCard[] = [
  { scheme: "Visa", pan: "4111 1111 1111 1111", expiry: "03/30", cvc: "737" },
  { scheme: "Mastercard", note: "3DS2", pan: "5454 5454 5454 5454", expiry: "03/30", cvc: "737" },
  { scheme: "Amex", pan: "3700 0000 0000 002", expiry: "03/30", cvc: "7373" },
  { scheme: "Cartes Bancaires", pan: "4035 5010 0000 0008", expiry: "03/30", cvc: "737" },
  { scheme: "Bancontact", pan: "6703 4444 4444 4449", expiry: "03/30", cvc: "737" },
  { scheme: "Diners", pan: "3600 6666 3333 44", expiry: "03/30", cvc: "737" },
  { scheme: "Discover", pan: "6011 6011 6011 6611", expiry: "03/30", cvc: "737" },
  { scheme: "UnionPay", pan: "6250 9460 0000 0016", expiry: "03/30", cvc: "737" },
];

export interface AltMethod {
  name: string;
  /** The pasteable credential. Absent on wallets, which have none. */
  value?: string;
  note?: string;
  /** Second line under the value, as on a card tile: PIN, expiry, and so on. */
  detail?: string;
  /** Rendered in italics, for wallets you can only test with your own account. */
  disclaimer?: { text: string; linkLabel: string; href: string };
}

/**
 * Wallets first: they are the ones people reach for and the ones that need
 * explaining. Then the gift card and iDEAL, then Klarna, whose flow only
 * needs the approved shopper phone number for the market you are testing.
 */
export const ALT_METHODS: AltMethod[] = [
  {
    name: "Apple Pay",
    disclaimer: {
      text: "You need your own Apple sandbox account to perform test transactions, " +
        "please visit:",
      linkLabel: "Apple Pay sandbox testing",
      href: "https://developer.apple.com/apple-pay/sandbox-testing/",
    },
  },
  {
    name: "PayPal",
    disclaimer: {
      text: "You need your own PayPal sandbox account to perform test transactions, " +
        "please visit:",
      linkLabel: "PayPal sandbox accounts",
      href: "https://developer.paypal.com/sandbox-testing/accounts",
    },
  },
  {
    name: "GiftCard (Givex)",
    value: "6036 2800 0000 0000 000",
    detail: "PIN 122222",
  },
  { name: "iDEAL", note: "bank", value: "TESTNL2A" },
  { name: "Klarna", note: "Netherlands", value: "+31689124321" },
  { name: "Klarna", note: "France", value: "+33689854321" },
  { name: "Klarna", note: "Germany", value: "+49017614284340" },
  { name: "Klarna", note: "United States", value: "+13106683312" },
];

export const KLARNA_DOCS =
  "https://docs.klarna.com/acquirer/adyen/resources/developer-tools/sample-data/sample-customer-data/#all-countries";

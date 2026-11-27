// Spec: knowledge/components/agentic-storefront.md
// Adyen's published TEST card numbers, shown beside Drop-in so a visitor can pay without the docs.
// None of them works on LIVE. Same values as packages/ui/testData.ts, which this app does not link.

export type TestCard = { scheme: string; note?: string; pan: string; expiry: string; cvc: string };

export const TEST_CARDS: readonly TestCard[] = [
  { scheme: "Visa", pan: "4111 1111 1111 1111", expiry: "03/30", cvc: "737" },
  {
    scheme: "Mastercard",
    note: "3-D Secure 2",
    pan: "5454 5454 5454 5454",
    expiry: "03/30",
    cvc: "737",
  },
  { scheme: "Cartes Bancaires", pan: "4035 5010 0000 0008", expiry: "03/30", cvc: "737" },
  { scheme: "Amex", pan: "3700 0000 0000 002", expiry: "03/30", cvc: "7373" },
];

export const ADYEN_TEST_CARDS_DOCS =
  "https://docs.adyen.com/development-resources/test-cards-and-credentials/test-card-numbers";

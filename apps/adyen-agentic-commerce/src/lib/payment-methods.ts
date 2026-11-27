// Spec: knowledge/components/agentic-storefront.md
// The card brands an order takes: the server lists them in the Adyen session's
// allowedPaymentMethods, and Drop-in (Sessions flow) reads them from there.
// Cartes Bancaires leads (owner, 2026-11-27); Discover, Diners and UnionPay ("cup") were added the
// same day. Adyen shows only the brands the merchant account has.
export const CARD_BRANDS = [
  "cartebancaire",
  "visa",
  "mc",
  "amex",
  "discover",
  "diners",
  "cup",
] as const;

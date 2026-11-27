// Spec: knowledge/components/agentic-storefront.md
// The card brands an order takes: the server lists them in the Adyen session's
// allowedPaymentMethods, and Drop-in (Sessions flow) reads them from there.
// Cartes Bancaires leads (owner, 2026-11-27): Drop-in shows the brands in this order.
export const CARD_BRANDS = ["cartebancaire", "visa", "mc", "amex"] as const;

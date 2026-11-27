// Spec: knowledge/components/agentic-storefront.md
// The card brands an order takes: the server lists them in the Adyen session and Drop-in's card is
// told the same, so no other brand is offered. Plain module, read by both sides.
// Cartes Bancaires leads (owner, 2026-11-27): Drop-in shows the brands in this order.
export const CARD_BRANDS = ["cartebancaire", "visa", "mc", "amex"] as const;

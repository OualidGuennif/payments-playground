// Spec: knowledge/components/agentic-storefront.md
// The card brands an order takes: the server lists them in the Adyen session and Drop-in's card is
// told the same, so no other brand is offered. Plain module, read by both sides.
export const CARD_BRANDS = ["visa", "mc", "cartebancaire", "amex"] as const;

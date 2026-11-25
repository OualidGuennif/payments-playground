// Spec: knowledge/components/adyen-agentic-commerce.md
// The shopper's saved cards as Adyen lists them, cached briefly and shown as aliases.
import { paymentsConfigured } from "../core/config";
import { get } from "../core/db";
import { trace } from "../core/trace";
import { sha256 } from "../core/util";
import * as adyen from "../payments/adyen";
import { type CardAlias, now } from "./model";

// Per account reference, for a minute; bounded since every account has its own entry.
const cardCache = new Map<string, { at: number; cards: CardAlias[] }>();
const CARD_CACHE_MAX = 1000;

export function cardAlias(storedPaymentMethodId: string) {
  return `card_${sha256(`velune:${storedPaymentMethodId}`).slice(0, 20)}`;
}

export async function savedCards(
  shopperReference: string | undefined,
  refresh = false,
): Promise<CardAlias[]> {
  if (!paymentsConfigured() || !shopperReference) return [];
  const cached = cardCache.get(shopperReference);
  if (!refresh && cached && Date.now() - cached.at < 60_000) return cached.cards;
  try {
    const cards = (await adyen.storedCards(shopperReference))
      .filter((c) => c.models.includes("UnscheduledCardOnFile"))
      .map((c) => ({
        alias: cardAlias(c.storedPaymentMethodId),
        storedPaymentMethodId: c.storedPaymentMethodId,
        brand: c.brand,
        lastFour: c.lastFour,
        expiryMonth: c.expiryMonth,
        expiryYear: c.expiryYear,
      }));
    if (!cardCache.has(shopperReference) && cardCache.size >= CARD_CACHE_MAX)
      cardCache.delete(cardCache.keys().next().value!);
    cardCache.set(shopperReference, { at: Date.now(), cards });
    return cards;
  } catch (error) {
    trace({
      channel: "adyen",
      actor: "server",
      method: "GET",
      path: "/storedPaymentMethods",
      status: 502,
      ref: null,
      detail: { error: (error as Error).message },
    });
    return cached?.cards ?? [];
  }
}

export function forgetCardCache(shopperReference?: string) {
  if (shopperReference) cardCache.delete(shopperReference);
  else cardCache.clear();
}

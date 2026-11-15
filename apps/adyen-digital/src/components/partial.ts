import { field } from "./read.ts";

/** An Adyen order split across payment methods, in minor units. */
export interface OrderProgress {
  total: number;
  paid: number;
  remaining: number;
  currency: string;
}

/** What is paid and left on the order Adyen Web hands to onOrderUpdated. */
export function orderProgress(order: unknown): OrderProgress | null {
  const total = field(order, "amount.value");
  const remaining = field(order, "remainingAmount.value");
  const currency = field(order, "amount.currency");
  if (typeof total !== "number" || typeof remaining !== "number" || typeof currency !== "string") {
    return null;
  }
  return { total, paid: total - remaining, remaining, currency };
}

/**
 * What one payment into an order charges. Adyen refuses a gift card asked
 * for more than its balance ("Not enough balance"), so it pays what the
 * balance covers; any other method pays what is left.
 */
export function partialAmount(input: {
  total: number;
  remaining: number | null;
  giftCardBalance: number | null;
}): number {
  const due = input.remaining ?? input.total;
  return input.giftCardBalance === null ? due : Math.min(input.giftCardBalance, due);
}

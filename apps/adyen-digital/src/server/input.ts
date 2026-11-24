// Spec: knowledge/components/adyen-digital.md
// Reading untrusted request bodies and Adyen answers into the shapes the routes use.
import type { Amount } from "@suite/platform/types.ts";

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * checkoutAttemptId is already carried inside sdkData, so forwarding it as a
 * sibling field duplicates the analytics payload, the legacy playground
 * stripped it for the same reason.
 */
export function sanitizePaymentMethod(paymentMethod: Record<string, unknown>) {
  const { checkoutAttemptId: _dropped, ...rest } = paymentMethod;
  return rest;
}

/**
 * The Adyen order a partial payment pays into, as Adyen Web holds it. Only
 * EncryptedOrderData's two fields go to /payments and /orders/cancel; the
 * rest of what the browser sends (amounts, expiry) is not trusted.
 */
export function orderReference(
  value: unknown,
): { orderData: string; pspReference: string } | undefined {
  const order = object(value);
  return typeof order.orderData === "string" && typeof order.pspReference === "string"
    ? { orderData: order.orderData, pspReference: order.pspReference }
    : undefined;
}

export function amountFrom(value: unknown, defaultCurrency = "EUR"): Amount {
  const candidate = object(value);
  const amount = Number(candidate.value);
  const currency = String(candidate.currency ?? defaultCurrency).toUpperCase();
  if (!Number.isInteger(amount) || amount < 1 || amount > 100_000_000) {
    throw new Error("Amount must be an integer between 1 and 100000000 minor units.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be an ISO 4217 code.");
  return { value: amount, currency };
}

/**
 * Adyen documents shopperConversionId as an opaque unique id, so a UUID is
 * kept as-is and anything else is replaced rather than trusted, the client
 * only ever echoes back a value this server minted.
 */
export function conversionIdFrom(value: unknown): string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID();
}

export function countryFrom(value: unknown): string {
  const country = String(value ?? "FR").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("countryCode must be ISO alpha-2.");
  return country;
}

export function resultField(result: unknown, field: string): unknown {
  return object(result)[field];
}

export function responseStatus(error: unknown): number {
  const candidate = object(error);
  const status = Number(candidate.statusCode ?? candidate.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

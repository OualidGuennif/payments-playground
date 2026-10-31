// Spec: knowledge/components/ui-package.md
export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  profileId?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const csrfToken = readCookie("adyen_csrf");
  if (csrfToken && !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (profileId) headers.set("X-Profile-Id", profileId);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({ error: "Invalid server response." }));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : `Request failed (${response.status}).`,
    );
  }
  return payload as T;
}

// Adyen's "minor units" are currency-exponent-aware, JPY and friends have no
// fractional unit, so their minor units equal their major units (¥110 is
// `{value: 110}`, not 11000). Dividing by 100 unconditionally under-displays
// them 100x.
import { ZERO_DECIMAL_CURRENCIES } from "@suite/platform/markets.ts";

export function formatMinorAmount(value: number, currency: string): string {
  const upperCurrency = currency.toUpperCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(upperCurrency);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: upperCurrency,
  }).format(isZeroDecimal ? value : value / 100);
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

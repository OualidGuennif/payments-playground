// Spec: knowledge/components/ui-package.md
import { treaty } from "@elysiajs/eden";
import type { Elysia } from "elysia";

export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
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

interface EdenResult<T> {
  data: T | null;
  error: { value: unknown } | null;
  status: number;
}

/**
 * An Eden answer's body, or the Error apiFetch would throw for it: the
 * server's `error` string, else `Request failed (<status>).` The platform's
 * error hook answers with a raw Response, which Eden adds to every route's
 * type; it is never a 2xx, so it never reaches `data`.
 */
export function unwrap<T>(result: EdenResult<T>): Exclude<T, Response> {
  // No answer at all: Eden wraps fetch's TypeError as a 503; rethrown as is, a caller can still
  // tell it from a real answer (the Back Office keeps its Idempotency-Key for the retry).
  if (result.error?.value instanceof TypeError) throw result.error.value;
  if (result.error || result.data === null) {
    const value = result.error?.value as { error?: unknown } | undefined;
    throw new Error(
      typeof value?.error === "string" ? value.error : `Request failed (${result.status}).`,
    );
  }
  return result.data as Exclude<T, Response>;
}

// Eden's own constraint on the App type, spelled as treaty declares it.
type AnyElysia = Elysia<any, any, any, any, any, any, any>;

/**
 * Eden's typed client for an app's Elysia routes, with the same headers as
 * apiFetch: the CSRF token from its cookie and the selected profile id, read
 * per call so a profile switch applies to the next request. Only the App type
 * crosses into the browser bundle.
 */
export function apiClient<App extends AnyElysia>(profileId?: () => string | undefined) {
  return treaty<App>(window.location.origin, {
    fetch: { credentials: "same-origin" },
    // Eden turns ISO date strings into Date objects by default, unlike the
    // types it infers; timestamps stay the strings the server sent.
    parseDate: false,
    headers() {
      const headers: Record<string, string> = {};
      const csrfToken = readCookie("adyen_csrf");
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const profile = profileId?.();
      if (profile) headers["x-profile-id"] = profile;
      return headers;
    },
  });
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

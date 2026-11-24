// Spec: knowledge/components/adyen-agentic-commerce.md
// The signed-in customer of a page request (ADR-015), read from the session cookie on the server.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Customer, customerFromToken, sessionCookieName } from "@/server/accounts/customers";

export async function currentCustomer(): Promise<Customer | undefined> {
  const jar = await cookies();
  return customerFromToken(jar.get(sessionCookieName())?.value);
}

const SAME_SITE = "http://store.invalid";

// Only a path on this site. A URL parser drops tabs and newlines and reads "\" as "/", so
// "/\t/evil.example" would become "//evil.example": refuse those characters, then resolve the
// value as the browser will and keep it only when it stays on this origin.
export function safeNext(value: string | undefined, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  const unsafe = (c: string) => c <= " " || c === "\u007f" || c === "\\";
  if ([...value].some(unsafe)) return fallback;
  try {
    const url = new URL(value, SAME_SITE);
    // Dot segments collapse while parsing, so "/..//host" comes out as "//host": the result must
    // itself be a path on this site.
    if (url.origin !== SAME_SITE || url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export async function requireCustomer(next: string): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) redirect(`/sign-in?next=${encodeURIComponent(safeNext(next))}`);
  return customer;
}

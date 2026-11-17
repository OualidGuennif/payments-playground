// Spec: knowledge/components/adyen-agentic-commerce.md
// The signed-in customer of a page request (ADR-015), read from the session cookie on the server.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Customer, customerFromToken, sessionCookieName } from "@/server/customers";

export async function currentCustomer(): Promise<Customer | undefined> {
  const jar = await cookies();
  return customerFromToken(jar.get(sessionCookieName())?.value);
}

// Only a path on this site: "//host" or "/\host" would send the shopper elsewhere after sign-in.
export function safeNext(value: string | undefined, fallback = "/account"): string {
  return value && /^\/(?![/\\])/.test(value) ? value : fallback;
}

export async function requireCustomer(next: string): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) redirect(`/sign-in?next=${encodeURIComponent(safeNext(next))}`);
  return customer;
}

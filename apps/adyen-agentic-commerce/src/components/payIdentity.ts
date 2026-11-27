// Spec: knowledge/components/agentic-storefront.md
// The Pay email modal's decisions that need no page (ADR-020): what the email check's answer means
// for the next step, and the welcome offer's saving as the server prices it.

// A shape check only; the server decides what it accepts.
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const MAX_EMAIL = 254;
export const WELCOME_RATE_PERCENT = 5;

export type EmailStep =
  | { step: "returning" }
  | { step: "new" }
  | { step: "limited" }
  | { step: "email"; problem: string };

const UNREACHABLE = "The store could not be reached. Try again.";
const INVALID = "This email does not look right. Check it, then continue.";

export type CheckFetch = (input: string, init: RequestInit) => Promise<Response>;

// Only a 200 that says yes or no picks a path; anything else keeps the shopper on the email with a
// reason, never on a guess about whether the account exists.
export async function checkEmail(
  email: string,
  fetcher: CheckFetch = (input, init) => fetch(input, init),
): Promise<EmailStep> {
  const address = email.trim();
  if (!address || address.length > MAX_EMAIL || !EMAIL_SHAPE.test(address))
    return { step: "email", problem: INVALID };
  try {
    const response = await fetcher("/api/session/check-email", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-velune-check": "1" },
      body: JSON.stringify({ email: address }),
    });
    if (response.status === 429) return { step: "limited" };
    if (response.status === 400) return { step: "email", problem: INVALID };
    if (!response.ok) return { step: "email", problem: UNREACHABLE };
    const body = (await response.json().catch(() => undefined)) as { exists?: unknown } | undefined;
    if (typeof body?.exists !== "boolean") return { step: "email", problem: UNREACHABLE };
    return { step: body.exists ? "returning" : "new" };
  } catch {
    return { step: "email", problem: UNREACHABLE };
  }
}

// The server rounds 5 % of the item subtotal to the cent and judges delivery before it, so the new
// total is the old one less this saving. Shown before the account exists; the claim's answer wins.
export const welcomeSaving = (subtotal: number): number =>
  Math.round((subtotal * WELCOME_RATE_PERCENT) / 100);

// Spec: knowledge/components/adyen-agentic-commerce.md
// The Back Office is public when the playground's basic auth is unset, so it shows an email as its
// first letter and domain only; screens shared in a demo show the same.
export function maskEmail(email: string | undefined | null): string {
  if (!email) return "unknown";
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

// The same shape the store accepts at sign-up and in buyer.email (any characters but space and @,
// a dot after the @), so a non-ASCII name or a numeric top-level domain is masked too. Wider than
// an email on purpose: a public page masks too much rather than too little.
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

// Every email anywhere in a value, masked: a record or a trace detail may carry one in any field,
// so the Back Office masks its whole answer rather than the fields known today.
export function maskEmails<T>(value: T, depth = 0): T {
  if (typeof value === "string") return value.replace(EMAIL, (email) => maskEmail(email)) as T;
  if (!value || typeof value !== "object") return value;
  // Deeper than any record or redacted trace detail: drop it rather than pass it unread.
  if (depth > 12) return "[depth]" as T;
  if (Array.isArray(value)) return value.map((v) => maskEmails(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  // Keys too: a trace detail keeps a caller's argument names, and one may be an email.
  for (const [key, v] of Object.entries(value)) out[maskEmails(key)] = maskEmails(v, depth + 1);
  return out as T;
}

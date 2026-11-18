// Spec: knowledge/components/adyen-agentic-commerce.md
// The Back Office is public when the playground's basic auth is unset, so it shows an email as its
// first letter and domain only; screens shared in a demo show the same.
export function maskEmail(email: string | undefined | null): string {
  if (!email) return "unknown";
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

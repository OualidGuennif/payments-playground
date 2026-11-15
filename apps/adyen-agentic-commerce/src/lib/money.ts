// Spec: knowledge/components/adyen-agentic-commerce.md
export function money(minor: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(minor / 100);
}

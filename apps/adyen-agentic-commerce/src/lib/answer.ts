// Spec: knowledge/components/adyen-agentic-commerce.md
export type Answer = { data: unknown; error: { value: unknown } | null };

// The server answers { error, message }; only the message is the shopper's to read.
export function messageOf(answer: Answer, fallback: string): string | undefined {
  if (!answer.error) return undefined;
  const value = answer.error.value as { message?: unknown } | undefined;
  return typeof value?.message === "string" ? value.message : fallback;
}

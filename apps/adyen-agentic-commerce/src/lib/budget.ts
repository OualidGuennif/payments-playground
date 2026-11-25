// Spec: knowledge/components/adyen-agentic-commerce.md
// An agent's limit is the total it may spend since it connected, what it already spent included.
// Shoppers read "budget" as what is left, so the account page shows both and adds to the total for
// them: 300 typed over a 300 limit raised nothing, silently (owner's report, 2026-11-25).
import { money } from "./money";

// The server's cap (oauth SPEND_LIMIT_MAX), so the page never offers a limit it would not keep.
export const LIMIT_MAX = 100_000;
export const TOP_UPS = [5_000, 10_000, 30_000];

/** The limit typed in EUR, in minor units within 0..LIMIT_MAX, or undefined when it is no number. */
export function limitFromInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const euros = Number(value);
  if (!Number.isFinite(euros)) return undefined;
  return Math.min(Math.max(Math.round(euros * 100), 0), LIMIT_MAX);
}

/** The total after adding to it, never past the cap. */
export const addToLimit = (limit: number, amount: number) => Math.min(limit + amount, LIMIT_MAX);

export type Preview =
  | { kind: "invalid" }
  | { kind: "same"; left: number }
  | { kind: "raise" | "lower"; left: number };

/** What a typed limit would leave the agent, against the limit it has now. */
export function previewLimit(wanted: number | undefined, current: number, spent: number): Preview {
  if (wanted === undefined) return { kind: "invalid" };
  const left = Math.max(wanted - spent, 0);
  if (wanted === current) return { kind: "same", left };
  return { kind: wanted > current ? "raise" : "lower", left };
}

export function previewText(preview: Preview, agentName: string): string {
  if (preview.kind === "invalid") return "Enter the total limit in EUR.";
  if (preview.kind === "same")
    return `That is the limit it has now: ${agentName} has ${money(preview.left)} left.`;
  return `${agentName} would have ${money(preview.left)} left to spend.`;
}

export const savedText = (agentName: string, left: number) =>
  `Saved. ${agentName} can spend ${money(left)} more.`;

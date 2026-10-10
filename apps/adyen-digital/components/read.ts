/** Reading loosely typed event payloads (Adyen Web state, API bodies, webhooks). */

/** The value at a dotted path, or undefined as soon as a step is missing. */
export function field(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** A scalar as display text; undefined for empty, missing or structured values. */
export function text(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Shortened to max characters with an ellipsis. */
export function clip(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

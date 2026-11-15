import type { JsonValue } from "./types.ts";

// This is a TEST-only playground: sessionData, sdkData, encrypted card blobs
// and similar fields are opaque ciphertext or fixture data, not real secrets,
// and hiding them defeats the whole point of the debug inspector. Only true
// infrastructure credentials, which would let someone call Adyen as this
// merchant, stay redacted, regardless of environment.
const DROP_KEYS = ["apikey", "authorization", "basicauth", "password", "rawbody"];

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function mask(value: unknown): string {
  const text = String(value ?? "");
  if (!text) return "[empty]";
  if (text.length <= 8) return "••••••••";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function sanitizeInternal(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeInternal(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 150)) {
      const normalized = normalizedKey(key);
      output[key] = DROP_KEYS.some((sensitive) => normalized.includes(sensitive))
        ? "[redacted]"
        : sanitizeInternal(entry, seen);
    }
    return output;
  }

  return String(value);
}

export function sanitize(value: unknown): JsonValue {
  return sanitizeInternal(value, new WeakSet());
}

export function rejectRawCardData(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const queue: unknown[] = [value];

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      const normalized = normalizedKey(key);
      if (
        ["cardnumber", "pan", "cvv", "cvc", "securitycode"].includes(normalized) &&
        typeof entry === "string" &&
        !entry.startsWith("adyenjs_")
      ) {
        throw new Error(
          "Raw card data is forbidden. Use Adyen encrypted fields or a storedPaymentMethodId.",
        );
      }
      if (entry && typeof entry === "object") queue.push(entry);
    }
  }
}

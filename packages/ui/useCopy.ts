import { useState } from "preact/hooks";

/**
 * Copies a value and flags it as copied for 1.6 s. Spaces are dropped by
 * default, so a card number pastes as one string; `raw` keeps the value as
 * is, for JSON or a URL.
 */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(value: string, options: { raw?: boolean } = {}) {
    try {
      await navigator.clipboard.writeText(options.raw ? value : value.replace(/\s/g, ""));
      setCopied(value);
      globalThis.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access is permission-gated; the value stays readable.
    }
  }
  return { copied, copy };
}

// Spec: knowledge/components/adyen-v6-styling.md
import type {
  CardOptions,
  CssRules,
  CssTokens,
  NativeOptions,
  SecureStyles,
  WalletOptions,
} from "./adyenOptions.ts";

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything the panel controls survives a reload. Building a theme takes
 * dozens of small decisions and losing them to an accidental refresh is the
 * kind of thing that stops people experimenting. Reset is the only way out,
 * and it asks first.
 *
 * The key is versioned: a stored blob written by an older build may name
 * options this one has dropped, and restoring it would resurrect them.
 */
export const STORAGE_KEY = "adyen-v6-styling.panel.v1";

export interface Persisted {
  country: string;
  locale: string;
  localeManual: boolean;
  section: "styling" | "configuration" | "css";
  secureStyles: SecureStyles;
  cssTokens: CssTokens;
  cssRules: CssRules;
  nativeOptions: NativeOptions;
  cardOptions: CardOptions;
  walletOptions: WalletOptions;
  showDonation: boolean;
}

// Read once per page load rather than per useState initialiser, and kept here
// so clearing it on reset also clears what the initialisers would see.
let storedCache: Partial<Persisted> | null | undefined;

export function stored(): Partial<Persisted> | null {
  if (storedCache !== undefined) return storedCache;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    storedCache = raw ? JSON.parse(raw) as Partial<Persisted> : null;
  } catch {
    // Private mode, disabled storage, or a blob this build can't parse.
    storedCache = null;
  }
  return storedCache;
}

export function clearStored() {
  storedCache = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if it was never writable.
  }
}

export function download(name: string, content: string, type: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

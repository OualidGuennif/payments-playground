// Theme presets: starting points for the secured fields, tokens and wallet buttons.
import type { CssTokens } from "./css-tokens.ts";
import { DEFAULT_SECURE, type SecureStyles } from "./secured-fields.ts";
import { DEFAULT_WALLETS, type WalletOptions } from "./wallets.ts";

/**
 * A starting point, not a destination, every value a preset sets is one you
 * can still change afterwards.
 *
 * They only touch what the checkout looks like: secured-field styles, design
 * tokens and the wallet buttons. Drop-in behaviour and card fields are left
 * alone, so picking a theme never changes which fields a shopper has to fill
 * in. None of them uses a class-name rule.
 */
export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  secure: SecureStyles;
  tokens: CssTokens;
  wallets: WalletOptions;
  showDonation: boolean;
}

/** The parts of the panel a theme owns, for spotting hand edits afterwards. */
export function themeSignature(
  secure: SecureStyles,
  tokens: CssTokens,
  wallets: WalletOptions,
  showDonation: boolean,
): string {
  return JSON.stringify([secure, tokens, wallets, showDonation]);
}

function secureWith(overrides: {
  color: string;
  placeholder: string;
  fontFamily?: string;
  fontWeight?: string;
}): SecureStyles {
  return {
    base: {
      ...DEFAULT_SECURE.base,
      color: overrides.color,
      caretColor: overrides.color,
      ...(overrides.fontFamily ? { fontFamily: overrides.fontFamily } : {}),
      ...(overrides.fontWeight ? { fontWeight: overrides.fontWeight } : {}),
    },
    error: DEFAULT_SECURE.error,
    placeholder: { ...DEFAULT_SECURE.placeholder, color: overrides.placeholder },
    validated: DEFAULT_SECURE.validated,
  };
}

const SYSTEM_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * The pay button reads three different tokens, rest, hover and active, and
 * they are not named as a family:
 *
 *   .adyen-checkout__button         background: color-background-always-dark
 *   .adyen-checkout__button:hover   background: color-background-inverse-primary-hover
 *   .adyen-checkout__button:active  background: color-background-always-dark-active
 *
 * Set only the first and the button reverts to Adyen's slate on hover, which
 * is how a themed button ends up flashing a colour from another palette.
 */
function payButton(rest: string, hover: string, active: string, label: string): CssTokens {
  return {
    "color-background-always-dark": rest,
    "color-background-inverse-primary-hover": hover,
    "color-background-always-dark-active": active,
    "color-label-on-color": label,
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "adyen",
    label: "Adyen default",
    description: "Nothing overridden, the Drop-in exactly as Adyen ships it.",
    secure: DEFAULT_SECURE,
    tokens: {},
    wallets: DEFAULT_WALLETS,
    showDonation: true,
  },
  {
    id: "mono",
    label: "Mono",
    description: "Pure black on white, flat 4px corners, system type.",
    secure: secureWith({ color: "#111111", placeholder: "#9b9b9b", fontFamily: SYSTEM_STACK }),
    tokens: {
      "color-label-primary": "#111111",
      "color-label-secondary": "#6b6b6b",
      "color-background-secondary": "#fafafa",
      "color-outline-primary": "#d9d9d9",
      "color-outline-primary-active": "#111111",
      ...payButton("#000000", "#1f1f1f", "#3a3a3a", "#ffffff"),
      "focus-ring-color": "rgba(17, 17, 17, 0.55)",
      // Flat 4px against Adyen's 8px medium: the clearest way this reads
      // different from the default at a glance.
      "border-radius-xs": "2px",
      "border-radius-s": "4px",
      "border-radius-m": "4px",
      "border-radius-l": "6px",
      "text-body-font-weight": "500",
    },
    wallets: {
      ...DEFAULT_WALLETS,
      applePayButtonColor: "black",
      applePayButtonRadius: "4px",
      googlePayButtonColor: "black",
      googlePayButtonRadius: "4",
      paypalColor: "black",
      paypalShape: "rect",
    },
    showDonation: true,
  },
  {
    id: "contrast",
    label: "Contrast",
    description: "Square, heavy and black-on-white. Closer to fashion and streetwear checkouts.",
    secure: secureWith({
      color: "#0a0a0a",
      placeholder: "#767676",
      fontFamily: SYSTEM_STACK,
      fontWeight: "600",
    }),
    tokens: {
      "color-label-primary": "#0a0a0a",
      "color-label-secondary": "#4a4a4a",
      "color-outline-primary": "#0a0a0a",
      "color-outline-primary-active": "#0a0a0a",
      ...payButton("#0a0a0a", "#262626", "#333333", "#ffffff"),
      "focus-ring-color": "rgba(10, 10, 10, 0.65)",
      "border-width-s": "2px",
      "border-radius-xs": "0px",
      "border-radius-s": "0px",
      "border-radius-m": "2px",
      "border-radius-l": "2px",
      "text-body-font-weight": "600",
    },
    wallets: {
      ...DEFAULT_WALLETS,
      applePayButtonType: "buy",
      applePayButtonColor: "black",
      applePayButtonRadius: "0px",
      googlePayButtonType: "buy",
      googlePayButtonColor: "black",
      googlePayButtonRadius: "0",
      paypalColor: "black",
      paypalShape: "rect",
    },
    showDonation: true,
  },
  {
    id: "soft",
    label: "Soft",
    description: "Warm paper and a deep teal, rounded and low-contrast. The restful one.",
    secure: secureWith({ color: "#1f2422", placeholder: "#9aa19d", fontFamily: SYSTEM_STACK }),
    tokens: {
      // Warm neutrals with a single desaturated accent: nothing fights for
      // attention, and the accent is deep enough to carry white text (6.5:1).
      "color-label-primary": "#1f2422",
      "color-label-secondary": "#6b7370",
      "color-background-secondary": "#faf7f4",
      "color-outline-primary": "#e4ded7",
      "color-outline-primary-active": "#12695f",
      ...payButton("#12695f", "#0e5449", "#0a453c", "#ffffff"),
      "focus-ring-color": "rgba(18, 105, 95, 0.45)",
      "border-radius-xs": "10px",
      "border-radius-s": "14px",
      "border-radius-m": "18px",
      "border-radius-l": "24px",
    },
    wallets: {
      ...DEFAULT_WALLETS,
      applePayButtonColor: "black",
      applePayButtonRadius: "9999px",
      googlePayButtonColor: "black",
      googlePayButtonRadius: "24",
      paypalColor: "gold",
      paypalShape: "pill",
    },
    showDonation: true,
  },
  {
    // A checkout for a dark page, picked by hand: the playground's own light
    // and dark switch never changes the theme being configured, because
    // the preview is what gets exported (owner, 2026-10-10). The surfaces are
    // the ones digital's checkout uses in dark mode.
    id: "dark",
    label: "Dark",
    description: "Light text on near-black surfaces, for a checkout on a dark page.",
    secure: {
      base: {
        ...DEFAULT_SECURE.base,
        color: "#eef1f6",
        caretColor: "#eef1f6",
        // The secured-field iframes paint their own background; it has to be
        // the input's, color-background-primary, or each field shows a light
        // box inside a dark one.
        background: "#16191f",
        fontFamily: SYSTEM_STACK,
      },
      error: { color: "#ff7b88" },
      placeholder: { ...DEFAULT_SECURE.placeholder, color: "#7b8493" },
      validated: { color: "#4ade80" },
    },
    tokens: {
      "color-background-primary": "#16191f",
      "color-background-primary-hover": "#1d2128",
      "color-background-secondary": "#1b1f26",
      "color-background-secondary-hover": "#242932",
      "color-background-secondary-active": "#2b313b",
      "color-background-tertiary": "#242932",
      "color-background-quaternary": "#39404c",
      "color-background-disabled": "#1b1f26",
      "color-background-inverse-primary": "#eef1f6",
      // Solid, not translucent: these two tints and the alert backgrounds are
      // edited with a colour picker, which only holds hex. Each is its
      // translucent tint laid over #16191f.
      "color-background-highlight-weak": "#212c3c",
      "color-background-success-weak": "#153128",
      // Light button, dark label: the inverse of the default.
      ...payButton("#eef1f6", "#ffffff", "#ffffff", "#0b0d11"),
      "color-label-primary": "#eef1f6",
      "color-label-secondary": "#a3acba",
      "color-label-tertiary": "#7b8493",
      "color-label-disabled": "#59616f",
      "color-label-highlight": "#6ea8ff",
      "color-label-critical": "#ff7b88",
      "color-label-success": "#4ade80",
      "color-label-on-background-highlight-weak": "#9cc4ff",
      "color-label-on-background-success-weak": "#4ade80",
      "color-outline-primary": "#39404c",
      "color-outline-primary-hover": "#59616f",
      "color-outline-primary-active": "#eef1f6",
      "color-outline-secondary": "#39404c",
      "color-outline-tertiary": "#59616f",
      "color-outline-tertiary-hover": "#eef1f6",
      "color-outline-tertiary-active": "#eef1f6",
      "color-outline-critical": "#ff7b88",
      "color-outline-disabled": "#272c35",
      "color-separator-primary": "#272c35",
      "color-separator-secondary": "#39404c",
      "focus-ring-color": "rgba(110, 168, 255, 0.6)",
      "alert-critical-background-color": "#34262d",
      "alert-warning-background-color": "#332d26",
      "alert-success-background-color": "#153128",
      "alert-highlight-background-color": "#212c3c",
      "button-tertiary-color": "#eef1f6",
      "toggle-track-background-color": "#1b1f26",
      "toggle-track-border": "1px solid #59616f",
      "toggle-track-hover-background-color": "#242932",
      "toggle-track-active-background-color": "#2b313b",
      "toggle-track-active-border-color": "#eef1f6",
    },
    wallets: {
      ...DEFAULT_WALLETS,
      applePayButtonColor: "white",
      googlePayButtonColor: "white",
      paypalColor: "white",
    },
    showDonation: true,
  },
];

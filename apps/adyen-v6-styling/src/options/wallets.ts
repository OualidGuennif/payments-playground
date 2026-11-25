// Wallets: the buttons Apple, Google and PayPal render themselves.

/**
 * A wallet button is drawn by the provider, not by Adyen, so none of the CSS
 * or the secured-field styles above reach it. Each vendor exposes its own
 * small set of knobs instead, and these are the ones that change what you can
 * see, the rest are merchant identifiers and flow callbacks.
 *
 * Values come from ApplePayConfiguration / GooglePayConfiguration /
 * PayPalConfiguration in @adyen/adyen-web 6.48.1.
 */
// Spelled out as unions rather than string[]: Adyen's own configuration types
// are unions, and a plain string here is rejected at the Dropin boundary.
export type ApplePayButtonType =
  | "add-money"
  | "book"
  | "buy"
  | "check-out"
  | "continue"
  | "contribute"
  | "donate"
  | "order"
  | "pay"
  | "plain"
  | "reload"
  | "rent"
  | "set-up"
  | "subscribe"
  | "support"
  | "tip"
  | "top-up";
export type ApplePayButtonColor = "black" | "white" | "white-outline";
export type GooglePayButtonType =
  | "book"
  | "buy"
  | "checkout"
  | "donate"
  | "order"
  | "pay"
  | "plain"
  | "subscribe";
export type GooglePayButtonColor = "default" | "black" | "white";
export type PayPalColor = "gold" | "blue" | "silver" | "white" | "black";
export type PayPalShape = "rect" | "pill";
export type PayPalLabel = "paypal" | "checkout" | "buynow" | "pay";

export const APPLE_PAY_BUTTON_TYPES: ApplePayButtonType[] = [
  "add-money",
  "book",
  "buy",
  "check-out",
  "continue",
  "contribute",
  "donate",
  "order",
  "pay",
  "plain",
  "reload",
  "rent",
  "set-up",
  "subscribe",
  "support",
  "tip",
  "top-up",
];
export const APPLE_PAY_BUTTON_COLORS: ApplePayButtonColor[] = ["black", "white", "white-outline"];

export const GOOGLE_PAY_BUTTON_TYPES: GooglePayButtonType[] = [
  "book",
  "buy",
  "checkout",
  "donate",
  "order",
  "pay",
  "plain",
  "subscribe",
];
export const GOOGLE_PAY_BUTTON_COLORS: GooglePayButtonColor[] = ["default", "black", "white"];

export const PAYPAL_COLORS: PayPalColor[] = ["gold", "blue", "silver", "white", "black"];
export const PAYPAL_SHAPES: PayPalShape[] = ["rect", "pill"];
export const PAYPAL_LABELS: PayPalLabel[] = ["paypal", "checkout", "buynow", "pay"];

/**
 * Apple ships the Pay button as a web component and Adyen has no config option
 * for its shape. Apple's own component reads
 * `border-radius: var(--apple-pay-button-border-radius, 4px)`, so the variable
 * is the way in, but it has to be set *on the element*: adyen.css declares
 *
 *   apple-pay-button { --apple-pay-button-border-radius: 4px }
 *
 * and a custom property declared on the element always beats one inherited
 * from an ancestor. Setting it on a wrapper does nothing at all.
 *
 * So the rule targets the element too, with the same specificity as Adyen's ,
 * source order settles it, and this stylesheet is meant to load after
 * adyen.css. It is also the plain thing a merchant would write, rather than a
 * selector engineered around a container class the Drop-in may not render.
 */
export const APPLE_PAY_RADIUS_VARIABLE = "--apple-pay-button-border-radius";
export const APPLE_PAY_BUTTON_SELECTOR = "apple-pay-button";

/** A bare number is the natural thing to type; CSS needs the unit. */
export function cssLength(value: string): string {
  const trimmed = value.trim();
  return /^\d*\.?\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

export interface WalletOptions {
  applePayButtonType: ApplePayButtonType | "";
  applePayButtonColor: ApplePayButtonColor | "";
  applePayTotalPriceLabel: string;
  /** CSS, not configuration, see APPLE_PAY_RADIUS_VARIABLE. */
  applePayButtonRadius: string;
  googlePayButtonType: GooglePayButtonType | "";
  googlePayButtonColor: GooglePayButtonColor | "";
  googlePayButtonRadius: string;
  paypalColor: PayPalColor | "";
  paypalShape: PayPalShape | "";
  paypalLabel: PayPalLabel | "";
  /** PayPal renders an extra instalments button; this is how you suppress it. */
  paypalBlockPayLater: boolean;
}

/** Empty everywhere: unset means the vendor's own default is left alone. */
export const DEFAULT_WALLETS: WalletOptions = {
  applePayButtonType: "",
  applePayButtonColor: "",
  applePayTotalPriceLabel: "",
  applePayButtonRadius: "",
  googlePayButtonType: "",
  googlePayButtonColor: "",
  googlePayButtonRadius: "",
  paypalColor: "",
  paypalShape: "",
  paypalLabel: "",
  paypalBlockPayLater: false,
};

/**
 * The Apple Pay rule, as a stylesheet block. Not an inline variable on the
 * preview wrapper: that is exactly the ancestor case adyen.css overrides.
 */
export function applePayCssBlock(wallets: WalletOptions): string | null {
  if (!wallets.applePayButtonRadius) return null;
  const radius = cssLength(wallets.applePayButtonRadius);
  return `${APPLE_PAY_BUTTON_SELECTOR} {\n  ${APPLE_PAY_RADIUS_VARIABLE}: ${radius};\n}`;
}

export function walletSetCount(wallets: WalletOptions, prefix: string): number {
  return Object.entries(wallets).filter(
    ([key, value]) => key.startsWith(prefix) && value !== "" && value !== false,
  ).length;
}

/**
 * Only what was actually changed. Sending a wallet an explicit copy of its own
 * default is noise in the config you copy out, and for Apple Pay an empty
 * string would be rendered as a blank line on the payment sheet.
 */
export function walletConfigObjects(wallets: WalletOptions) {
  const applepay = {
    ...(wallets.applePayButtonType ? { buttonType: wallets.applePayButtonType } : {}),
    ...(wallets.applePayButtonColor ? { buttonColor: wallets.applePayButtonColor } : {}),
    ...(wallets.applePayTotalPriceLabel
      ? { totalPriceLabel: wallets.applePayTotalPriceLabel }
      : {}),
  };
  const radius = Number.parseInt(wallets.googlePayButtonRadius, 10);
  const googlepay = {
    ...(wallets.googlePayButtonType ? { buttonType: wallets.googlePayButtonType } : {}),
    ...(wallets.googlePayButtonColor ? { buttonColor: wallets.googlePayButtonColor } : {}),
    ...(Number.isFinite(radius) ? { buttonRadius: radius } : {}),
  };
  const paypalStyle = {
    ...(wallets.paypalColor ? { color: wallets.paypalColor } : {}),
    ...(wallets.paypalShape ? { shape: wallets.paypalShape } : {}),
    ...(wallets.paypalLabel ? { label: wallets.paypalLabel } : {}),
  };
  const paypal = {
    ...(Object.keys(paypalStyle).length > 0 ? { style: paypalStyle } : {}),
    // Only sent when on: PayPal decides on its own whether Pay Later is
    // eligible for the amount and market, and an explicit false is the one
    // thing that overrules it.
    ...(wallets.paypalBlockPayLater ? { blockPayPalPayLaterButton: true } : {}),
  };
  return {
    ...(Object.keys(applepay).length > 0 ? { applepay } : {}),
    ...(Object.keys(googlepay).length > 0 ? { googlepay } : {}),
    ...(Object.keys(paypal).length > 0 ? { paypal } : {}),
  };
}

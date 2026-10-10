/**
 * Every native option this playground exposes, in one place.
 *
 * The lists are not a hand-picked subset: the secured-field properties are
 * StyleDefinitions, the card/Drop-in options are CardConfiguration and
 * DropinConfiguration (all of them that a merchant is allowed to set), and the
 * CSS custom properties are the ones actually shipped in adyen.css, all read
 * from @adyen/adyen-web 6.46.0. Re-check them on every SDK bump.
 */

import {
  INSTALLMENT_COUNTRIES,
  SOCIAL_SECURITY_NUMBER_COUNTRIES,
} from "@suite/ui/paymentMethods.ts";

export const ADYEN_WEB_VERSION = "6.46.0";
export const ADYEN_CSS_URL =
  `https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/${ADYEN_WEB_VERSION}/adyen.css`;

export type ControlKind = "color" | "text" | "select" | "range";

export interface ControlSpec {
  kind: ControlKind;
  /** What Adyen itself uses. Shown as the placeholder / slider start value. */
  fallback?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

const FONT_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
const FONT_SMOOTHING = ["antialiased", "subpixel-antialiased", "none"];

/* -------------------------------------------------------------------------- */
/* Secured fields: the styles object                                          */
/* -------------------------------------------------------------------------- */

/**
 * The card number, expiry date and security code live in Adyen-hosted
 * iframes, so no page CSS can reach them: they are styled exclusively through
 * this object, and only these four states exist.
 */
export const SECURE_STATES = ["base", "placeholder", "error", "validated"] as const;
export type SecureState = typeof SECURE_STATES[number];

export const SECURE_STATE_META: Record<SecureState, { label: string; hint: string }> = {
  base: {
    label: "Base",
    hint: "Every secured field, at all times. Adyen defaults: #001b2b, 16px, weight 400.",
  },
  error: {
    label: "Error",
    hint: "While the field content is invalid. Adyen default: #001b2b (only the label turns red).",
  },
  placeholder: {
    label: "Placeholder",
    hint: "The placeholder text. Adyen defaults: #90a2bd, weight 200.",
  },
  validated: {
    label: "Validated",
    hint: "Once the field content is valid. Adyen ships no default for this state.",
  },
};

export type SecureProperty =
  | "background"
  | "caretColor"
  | "color"
  | "display"
  | "font"
  | "fontFamily"
  | "fontSize"
  | "fontSizeAdjust"
  | "fontSmoothing"
  | "fontStretch"
  | "fontStyle"
  | "fontVariant"
  | "fontVariantAlternates"
  | "fontVariantCaps"
  | "fontVariantEastAsian"
  | "fontVariantLigatures"
  | "fontVariantNumeric"
  | "fontWeight"
  | "letterSpacing"
  | "lineHeight"
  | "mozOsxFontSmoothing"
  | "mozTransition"
  | "opacity"
  | "outline"
  | "padding"
  | "textAlign"
  | "textShadow"
  | "transition"
  | "webkitFontSmoothing"
  | "webkitTransition"
  | "wordSpacing";

export const SECURE_GROUPS = [
  "Color",
  "Typography",
  "Font variants",
  "Text rendering",
  "Box & motion",
] as const;
export type SecureGroup = typeof SECURE_GROUPS[number];

export interface SecurePropertySpec extends ControlSpec {
  property: SecureProperty;
  label: string;
  group: SecureGroup;
  hint?: string;
}

export const SECURE_PROPERTY_SPECS: SecurePropertySpec[] = [
  { property: "color", label: "color", group: "Color", kind: "color", fallback: "#001b2b" },
  { property: "background", label: "background", group: "Color", kind: "color" },
  { property: "caretColor", label: "caretColor", group: "Color", kind: "color" },
  {
    property: "opacity",
    label: "opacity",
    group: "Color",
    kind: "range",
    min: 0,
    max: 1,
    step: 0.05,
    fallback: "1",
  },
  {
    property: "fontSize",
    label: "fontSize",
    group: "Typography",
    kind: "range",
    min: 8,
    max: 32,
    step: 1,
    unit: "px",
    fallback: "16px",
  },
  {
    property: "fontWeight",
    label: "fontWeight",
    group: "Typography",
    kind: "select",
    options: FONT_WEIGHTS,
    fallback: "400",
  },
  {
    property: "fontFamily",
    label: "fontFamily",
    group: "Typography",
    kind: "text",
    fallback: "inherited from the page",
  },
  {
    property: "fontStyle",
    label: "fontStyle",
    group: "Typography",
    kind: "select",
    options: ["normal", "italic", "oblique"],
  },
  {
    property: "fontStretch",
    label: "fontStretch",
    group: "Typography",
    kind: "select",
    options: [
      "normal",
      "ultra-condensed",
      "extra-condensed",
      "condensed",
      "semi-condensed",
      "semi-expanded",
      "expanded",
      "extra-expanded",
      "ultra-expanded",
    ],
  },
  {
    property: "fontSizeAdjust",
    label: "fontSizeAdjust",
    group: "Typography",
    kind: "text",
    fallback: "0.5",
  },
  {
    property: "lineHeight",
    label: "lineHeight",
    group: "Typography",
    kind: "range",
    min: 12,
    max: 48,
    step: 1,
    unit: "px",
  },
  {
    property: "letterSpacing",
    label: "letterSpacing",
    group: "Typography",
    kind: "range",
    min: -2,
    max: 8,
    step: 0.1,
    unit: "px",
  },
  {
    property: "wordSpacing",
    label: "wordSpacing",
    group: "Typography",
    kind: "range",
    min: -4,
    max: 16,
    step: 0.5,
    unit: "px",
  },
  {
    property: "font",
    label: "font",
    group: "Typography",
    kind: "text",
    fallback: "italic 500 16px/24px Arial",
    hint: "Shorthand: overrides the individual font properties above.",
  },
  {
    property: "fontVariant",
    label: "fontVariant",
    group: "Font variants",
    kind: "text",
    fallback: "small-caps",
  },
  {
    property: "fontVariantCaps",
    label: "fontVariantCaps",
    group: "Font variants",
    kind: "select",
    options: [
      "normal",
      "small-caps",
      "all-small-caps",
      "petite-caps",
      "all-petite-caps",
      "unicase",
      "titling-caps",
    ],
  },
  {
    property: "fontVariantNumeric",
    label: "fontVariantNumeric",
    group: "Font variants",
    kind: "select",
    options: [
      "normal",
      "ordinal",
      "slashed-zero",
      "lining-nums",
      "oldstyle-nums",
      "proportional-nums",
      "tabular-nums",
    ],
    hint: "tabular-nums keeps the digits from shifting as the shopper types.",
  },
  {
    property: "fontVariantLigatures",
    label: "fontVariantLigatures",
    group: "Font variants",
    kind: "select",
    options: [
      "normal",
      "none",
      "common-ligatures",
      "no-common-ligatures",
      "discretionary-ligatures",
      "historical-ligatures",
      "contextual",
      "no-contextual",
    ],
  },
  {
    property: "fontVariantAlternates",
    label: "fontVariantAlternates",
    group: "Font variants",
    kind: "text",
    fallback: "historical-forms",
  },
  {
    property: "fontVariantEastAsian",
    label: "fontVariantEastAsian",
    group: "Font variants",
    kind: "text",
    fallback: "jis78 full-width",
  },
  {
    property: "textAlign",
    label: "textAlign",
    group: "Text rendering",
    kind: "select",
    options: ["left", "center", "right", "start", "end", "justify"],
  },
  {
    property: "textShadow",
    label: "textShadow",
    group: "Text rendering",
    kind: "text",
    fallback: "0 1px 0 rgba(0, 0, 0, 0.15)",
  },
  {
    property: "fontSmoothing",
    label: "fontSmoothing",
    group: "Text rendering",
    kind: "select",
    options: FONT_SMOOTHING,
  },
  {
    property: "webkitFontSmoothing",
    label: "webkitFontSmoothing",
    group: "Text rendering",
    kind: "select",
    options: FONT_SMOOTHING,
  },
  {
    property: "mozOsxFontSmoothing",
    label: "mozOsxFontSmoothing",
    group: "Text rendering",
    kind: "select",
    options: ["auto", "grayscale", "unset"],
  },
  {
    property: "display",
    label: "display",
    group: "Text rendering",
    kind: "select",
    options: ["block", "inline-block", "flex", "inline-flex", "inline"],
    hint: "The iframe only holds a single input, display: none hides the field.",
  },
  {
    property: "padding",
    label: "padding",
    group: "Box & motion",
    kind: "text",
    fallback: "0 8px",
    hint: "Applied inside the iframe, on the input itself.",
  },
  {
    property: "outline",
    label: "outline",
    group: "Box & motion",
    kind: "text",
    fallback: "1px solid #0070f5",
  },
  {
    property: "transition",
    label: "transition",
    group: "Box & motion",
    kind: "text",
    fallback: "color 150ms ease",
  },
  {
    property: "webkitTransition",
    label: "webkitTransition",
    group: "Box & motion",
    kind: "text",
  },
  {
    property: "mozTransition",
    label: "mozTransition",
    group: "Box & motion",
    kind: "text",
  },
];

export type SecureStateStyles = Partial<Record<SecureProperty, string>>;
export type SecureStyles = Record<SecureState, SecureStateStyles>;

export const DEFAULT_SECURE: SecureStyles = {
  base: {
    color: "#00112c",
    background: "#ffffff",
    caretColor: "#00112c",
    fontSize: "16px",
    fontWeight: "400",
    fontFamily: "Arial, sans-serif",
    lineHeight: "24px",
    textAlign: "left",
    fontSmoothing: "antialiased",
  },
  error: { color: "#c12435" },
  placeholder: { color: "#8d95a3", fontWeight: "200" },
  validated: { color: "#07883b" },
};

/** Drops the properties left at the Adyen default so the output stays paste-able. */
export function secureStyleObject(styles: SecureStyles) {
  const result: Partial<Record<SecureState, SecureStateStyles>> = {};
  for (const state of SECURE_STATES) {
    const set = Object.entries(styles[state]).filter(([, value]) => value !== "");
    if (set.length > 0) result[state] = Object.fromEntries(set);
  }
  return result;
}

export function secureSetCount(styles: SecureStyles, state: SecureState, group?: SecureGroup) {
  return SECURE_PROPERTY_SPECS
    .filter((spec) => !group || spec.group === group)
    .filter((spec) => styles[state][spec.property]).length;
}

/* -------------------------------------------------------------------------- */
/* CSS custom properties                                                      */
/* -------------------------------------------------------------------------- */

export const CSS_TOKEN_GROUPS = [
  "Labels",
  "Surfaces",
  "Outlines & separators",
  "Radius & borders",
  "Focus & shadow",
  "Alerts",
  "Buttons",
  "Toggle",
  "Tooltip",
  "Spacing",
  "Typography",
  "Motion",
] as const;
export type CssTokenGroup = typeof CSS_TOKEN_GROUPS[number];

export interface CssTokenSpec extends ControlSpec {
  /** Without the --adyen-sdk- prefix. */
  token: string;
  label: string;
  group: CssTokenGroup;
  fallback: string;
}

/** Token name → the override the user typed. Absent/empty means "leave to Adyen". */
export type CssTokens = Record<string, string>;

type TokenEntry = [token: string, fallback: string, overrides?: Partial<CssTokenSpec>];

function humanize(name: string): string {
  const words = name.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A hex value is a swatch, a single length is a slider, everything else is free text. */
function inferKind(fallback: string): ControlKind {
  if (/^#[0-9a-f]{3,8}$/i.test(fallback)) return "color";
  if (/^-?\d*\.?\d+(px|rem|s)$/.test(fallback)) return "range";
  return "text";
}

function inferRange(fallback: string): Partial<ControlSpec> {
  const unit = fallback.replace(/^-?\d*\.?\d+/, "");
  if (unit === "rem") return { unit, min: 0.5, max: 3, step: 0.0625 };
  if (unit === "s") return { unit, min: 0, max: 1, step: 0.05 };
  return { unit: "px", min: 0, max: 64, step: 1 };
}

function tokenGroup(
  group: CssTokenGroup,
  labelPrefix: string,
  entries: TokenEntry[],
  shared: Partial<CssTokenSpec> = {},
): CssTokenSpec[] {
  return entries.map(([token, fallback, overrides]) => ({
    token,
    fallback,
    group,
    label: humanize(token.slice(labelPrefix.length)),
    kind: inferKind(fallback),
    ...inferRange(fallback),
    ...shared,
    ...overrides,
  }));
}

const WEIGHT_TOKEN: Partial<CssTokenSpec> = { kind: "select", options: FONT_WEIGHTS };

export const CSS_TOKEN_SPECS: CssTokenSpec[] = [
  ...tokenGroup("Labels", "color-label-", [
    ["color-label-primary", "#00112c"],
    ["color-label-secondary", "#5c687c"],
    ["color-label-tertiary", "#5c687c"],
    ["color-label-disabled", "#8d95a3"],
    ["color-label-highlight", "#00112c"],
    ["color-label-critical", "#c72727"],
    ["color-label-success", "#07893c"],
    ["color-label-on-color", "#ffffff"],
    ["color-label-on-background-highlight-weak", "#0063d7"],
    ["color-label-on-background-success-weak", "#067934"],
  ]),
  ...tokenGroup("Surfaces", "color-background-", [
    ["color-background-primary", "#ffffff"],
    ["color-background-primary-hover", "#f7f7f8"],
    ["color-background-secondary", "#f7f7f8"],
    ["color-background-secondary-hover", "#eeeff1"],
    ["color-background-secondary-active", "#e3e5e9"],
    ["color-background-tertiary", "#eeeff1"],
    ["color-background-quaternary", "#c0c5cc"],
    ["color-background-disabled", "#eeeff1"],
    ["color-background-inverse-primary", "#00112c"],
    ["color-background-inverse-primary-hover", "#5c687c"],
    ["color-background-always-dark", "#00112c"],
    ["color-background-always-dark-active", "#8d95a3"],
    ["color-background-critical-strong", "#e22d2d"],
    ["color-background-highlight-weak", "#f2f8ff"],
    ["color-background-success-weak", "#edfaf3"],
  ]),
  ...tokenGroup("Outlines & separators", "color-", [
    ["color-outline-primary", "#dbdee2"],
    ["color-outline-primary-hover", "#c9cdd3"],
    ["color-outline-primary-active", "#00112c"],
    ["color-outline-secondary", "#c9cdd3"],
    ["color-outline-tertiary", "#848d96"],
    ["color-outline-tertiary-hover", "#00112c"],
    ["color-outline-tertiary-active", "#00112c"],
    ["color-outline-critical", "#e22d2d"],
    ["color-outline-disabled", "#dbdee2"],
    ["color-separator-primary", "#dbdee2"],
    ["color-separator-secondary", "#c9cdd3"],
  ]),
  ...tokenGroup("Radius & borders", "border-", [
    ["border-radius-xs", "2px"],
    ["border-radius-s", "4px"],
    ["border-radius-m", "8px"],
    ["border-radius-l", "12px"],
    ["border-width-s", "1px", { max: 12 }],
    ["border-width-l", "3px", { max: 12 }],
  ], { max: 32 }),
  ...tokenGroup("Focus & shadow", "", [
    ["focus-ring-color", "rgba(0, 112, 245, 0.8)"],
    ["focus-ring-outline", "3px", { max: 12 }],
    ["focus-ring-spacer", "1px", { max: 12 }],
    ["shadow-low", "0 2px 4px rgba(0, 17, 44, 0.04), 0 1px 2px rgba(0, 17, 44, 0.02)"],
  ]),
  ...tokenGroup("Alerts", "alert-", [
    ["alert-critical-background-color", "#fef4f4"],
    ["alert-warning-background-color", "#fff5e9"],
    ["alert-success-background-color", "#edfaf3"],
    ["alert-highlight-background-color", "#f2f8ff"],
  ]),
  ...tokenGroup("Buttons", "button-", [
    ["button-tertiary-color", "#00112c"],
    ["button-tertiary-active-color", "#8d95a3"],
    ["button-tertiary-active-background-color", "rgba(0, 0, 0, 0)"],
    ["button-tertiary-box-shadow", "inset 0 0 0 1px rgba(0, 0, 0, 0)"],
    ["button-icon-only-padding", "10px", { max: 32 }],
  ]),
  ...tokenGroup("Toggle", "toggle-", [
    ["toggle-track-background-color", "#ffffff"],
    ["toggle-track-border", "1px solid #8d95a3"],
    ["toggle-track-border-radius", "12px", { max: 32 }],
    ["toggle-track-width", "36px"],
    ["toggle-track-height", "20px"],
    ["toggle-track-padding", "2px 4px"],
    ["toggle-track-hover-background-color", "#f7f7f8"],
    ["toggle-track-hover-border-color", "#6d7789"],
    ["toggle-track-active-background-color", "#eeeff1"],
    ["toggle-track-active-border-color", "#00112c"],
    ["toggle-track-disabled-background-color", "#f7f7f8"],
    ["toggle-track-disabled-border-color", "#dbdee2"],
    ["toggle-track-readonly-background-color", "#f7f7f8"],
    ["toggle-track-readonly-border-color", "#dbdee2"],
    ["toggle-track-toggled-background-color", "#00112c"],
    ["toggle-track-toggled-border", "0"],
    ["toggle-track-toggled-padding", "2px"],
    ["toggle-track-toggled-hover-background-color", "#5c687c"],
    ["toggle-track-toggled-active-background-color", "#8d95a3"],
    ["toggle-track-toggled-disabled-background-color", "#c0c5cc"],
    ["toggle-track-toggled-readonly-background-color", "#c0c5cc"],
    ["toggle-handle-background-color", "#00112c"],
    ["toggle-handle-border-radius", "12px", { max: 32 }],
    ["toggle-handle-width", "12px"],
    ["toggle-handle-height", "12px"],
    ["toggle-handle-transition", "transform 0.15s cubic-bezier(0.2, 0, 0.4, 0.9)"],
    ["toggle-handle-disabled-background-color", "#8d95a3"],
    ["toggle-handle-toggled-background-color", "#ffffff"],
    ["toggle-handle-toggled-color", "#00112c"],
    ["toggle-handle-toggled-width", "16px"],
    ["toggle-handle-toggled-height", "16px"],
    ["toggle-handle-toggled-disabled-background-color", "#eeeff1"],
    ["toggle-handle-toggled-disabled-color", "#8d95a3"],
    ["toggle-handle-toggled-readonly-background-color", "#eeeff1"],
    ["toggle-label-padding", "16px", { max: 48 }],
    ["toggle-description-color", "#5c687c"],
    ["toggle-description-padding", "4px", { max: 48 }],
  ]),
  ...tokenGroup("Tooltip", "tooltip-", [
    ["tooltip-background-color", "#00112c"],
    ["tooltip-color", "#ffffff"],
    ["tooltip-border-radius", "4px", { max: 32 }],
    ["tooltip-padding", "4px 8px"],
    ["tooltip-z-index", "5"],
  ]),
  ...tokenGroup("Spacing", "", [
    ["spacer-000", "0"],
    ["spacer-010", "2px"],
    ["spacer-020", "4px"],
    ["spacer-030", "6px"],
    ["spacer-040", "8px"],
    ["spacer-050", "10px"],
    ["spacer-060", "12px"],
    ["spacer-070", "16px"],
    ["spacer-080", "20px"],
    ["spacer-090", "24px"],
    ["spacer-100", "32px"],
    ["spacer-110", "40px"],
    ["spacer-120", "48px"],
    ["spacer-130", "56px"],
    ["spacer-140", "64px"],
  ], { kind: "range", unit: "px", min: 0, max: 96, step: 1 }),
  ...tokenGroup("Typography", "text-", [
    ["text-body-font-size", "0.875rem"],
    ["text-body-font-weight", "400", WEIGHT_TOKEN],
    ["text-body-line-height", "20px", { max: 60 }],
    ["text-body-wide-line-height", "24px", { max: 60 }],
    ["text-body-stronger-font-weight", "500", WEIGHT_TOKEN],
    ["text-body-strongest-font-weight", "600", WEIGHT_TOKEN],
    ["text-caption-font-size", "0.75rem"],
    ["text-caption-font-weight", "400", WEIGHT_TOKEN],
    ["text-caption-line-height", "18px", { max: 60 }],
    ["text-caption-stronger-font-weight", "500", WEIGHT_TOKEN],
    ["text-subtitle-font-size", "1rem"],
    ["text-subtitle-font-weight", "500", WEIGHT_TOKEN],
    ["text-subtitle-line-height", "26px", { max: 60 }],
    ["text-subtitle-stronger-font-weight", "600", WEIGHT_TOKEN],
    ["text-title-font-size", "1rem"],
    ["text-title-font-weight", "600", WEIGHT_TOKEN],
    ["text-title-line-height", "26px", { max: 60 }],
    ["text-title-m-font-size", "1.25rem", { label: "Title M font size" }],
    ["text-title-m-font-weight", "600", { ...WEIGHT_TOKEN, label: "Title M font weight" }],
    ["text-title-m-line-height", "30px", { label: "Title M line height", max: 60 }],
    ["text-title-l-font-size", "1.5rem", { label: "Title L font size" }],
    ["text-title-l-font-weight", "600", { ...WEIGHT_TOKEN, label: "Title L font weight" }],
    ["text-title-l-line-height", "34px", { label: "Title L line height", max: 60 }],
  ]),
  ...tokenGroup("Motion", "animation-", [
    ["animation-duration-fast", "0.1s"],
    ["animation-duration-moderate", "0.15s"],
    ["animation-easing-standard", "cubic-bezier(0.2, 0, 0.4, 0.9)"],
    ["animation-easing-linear", "linear"],
  ]),
];

export function cssTokenSpec(token: string): CssTokenSpec {
  const spec = CSS_TOKEN_SPECS.find((entry) => entry.token === token);
  if (!spec) throw new Error(`Unknown Adyen CSS token: ${token}`);
  return spec;
}

export function cssTokenSetCount(tokens: CssTokens, group?: CssTokenGroup) {
  return CSS_TOKEN_SPECS
    .filter((spec) => !group || spec.group === group)
    .filter((spec) => tokens[spec.token]).length;
}

/**
 * Rules that have no design token behind them, so they have to be written as
 * plain CSS against Adyen's class names. Those class names are internal and
 * can change on any SDK upgrade, unlike the tokens above.
 */
export interface CssRules {
  payButtonBackground: string;
  payButtonColor: string;
  methodSpacing: string;
  uppercaseButton: boolean;
  compactMethods: boolean;
}

export const DEFAULT_CSS_RULES: CssRules = {
  payButtonBackground: "",
  payButtonColor: "",
  methodSpacing: "",
  uppercaseButton: false,
  compactMethods: false,
};

export const CSS_RULE_SPECS: {
  key: "payButtonBackground" | "payButtonColor" | "methodSpacing";
  label: string;
  spec: ControlSpec;
  hint?: string;
}[] = [
  {
    key: "payButtonBackground",
    label: "Pay button background",
    spec: { kind: "color", fallback: "#00112c" },
    hint: "Prefer the token: color-background-inverse-primary.",
  },
  {
    key: "payButtonColor",
    label: "Pay button label",
    spec: { kind: "color", fallback: "#ffffff" },
    hint: "Prefer the token: color-label-on-color.",
  },
  {
    key: "methodSpacing",
    label: "Space between methods",
    spec: { kind: "range", fallback: "0px", unit: "px", min: 0, max: 32, step: 1 },
  },
];

export function cssRuleSetCount(rules: CssRules) {
  return CSS_RULE_SPECS.filter(({ key }) => rules[key]).length +
    (rules.uppercaseButton ? 1 : 0) + (rules.compactMethods ? 1 : 0);
}

const NOTHING_SET = "/* Nothing overridden yet, the Drop-in runs Adyen's own values. */";

const CSS_HEADER = `/* Adyen Web ${ADYEN_WEB_VERSION}, TEST playground overrides.
 * Import after @adyen/adyen-web/styles/adyen.css.
 */
`;

export function cssText(tokens: CssTokens, rules: CssRules, wallets?: WalletOptions): string {
  const blocks: string[] = [];
  const overrides = CSS_TOKEN_SPECS
    .filter((spec) => tokens[spec.token])
    .map((spec) => `  --adyen-sdk-${spec.token}: ${tokens[spec.token]};`);
  if (overrides.length > 0) blocks.push(`.adyen-checkout {\n${overrides.join("\n")}\n}`);
  const applePay = wallets ? applePayCssBlock(wallets) : null;
  if (applePay) blocks.push(applePay);

  const button = [
    rules.payButtonBackground ? `  background: ${rules.payButtonBackground};` : "",
    rules.payButtonColor ? `  color: ${rules.payButtonColor};` : "",
    rules.uppercaseButton ? "  text-transform: uppercase;" : "",
  ].filter(Boolean);
  if (button.length > 0) {
    blocks.push(`.adyen-checkout__button--pay {\n${button.join("\n")}\n}`);
  }
  if (rules.methodSpacing) {
    blocks.push(`.adyen-checkout__payment-method {\n  margin-bottom: ${rules.methodSpacing};\n}`);
  }
  if (rules.compactMethods) {
    blocks.push(".adyen-checkout__payment-method__header {\n  padding-block: 8px;\n}");
  }
  if (blocks.length === 0) return `${CSS_HEADER}\n${NOTHING_SET}\n`;
  return `${CSS_HEADER}\n${blocks.join("\n\n")}\n`;
}

/**
 * The same overrides as inline custom properties, so the page around the
 * Drop-in (its own background, card radius) follows the theme too.
 */
// Keyed on `--${string}` rather than string so the result stays assignable to
// the JSX style prop, which only tolerates custom properties as extra keys.
export function cssPreviewVariables(tokens: CssTokens): Record<`--${string}`, string> {
  const variables: Record<`--${string}`, string> = {};
  for (const spec of CSS_TOKEN_SPECS) {
    if (tokens[spec.token]) variables[`--adyen-sdk-${spec.token}`] = tokens[spec.token];
  }
  return variables;
}

/* -------------------------------------------------------------------------- */
/* Drop-in options (DropinConfiguration)                                      */
/* -------------------------------------------------------------------------- */

export type InstantPaymentType = "applepay" | "googlepay";

export interface NativeOptions {
  openFirstPaymentMethod: boolean;
  openFirstStoredPaymentMethod: boolean;
  openPaymentMethodType: string;
  instantPaymentTypes: InstantPaymentType[];
  showPaymentMethods: boolean;
  showStoredPaymentMethods: boolean;
  showRadioButton: boolean;
  disableFinalAnimation: boolean;
}

export const DEFAULT_NATIVE: NativeOptions = {
  openFirstPaymentMethod: false,
  openFirstStoredPaymentMethod: false,
  openPaymentMethodType: "",
  instantPaymentTypes: ["applepay", "googlepay"],
  showPaymentMethods: true,
  showStoredPaymentMethods: true,
  showRadioButton: false,
  disableFinalAnimation: false,
};

/* -------------------------------------------------------------------------- */
/* Card options (CardConfiguration)                                           */
/* -------------------------------------------------------------------------- */

export type SocialSecurityNumberMode = "auto" | "show" | "hide";
export type BillingAddressMode = "full" | "partial" | "none";

/** Adyen's own address schema, used for billingAddressRequiredFields. */
export const ADDRESS_FIELDS: [string, string][] = [
  ["street", "Street"],
  ["houseNumberOrName", "House number"],
  ["postalCode", "Postal code"],
  ["city", "City"],
  ["stateOrProvince", "State / province"],
  ["country", "Country"],
];

export type PlaceholderKey =
  | "holderName"
  | "cardNumber"
  | "expiryDate"
  | "expiryMonth"
  | "expiryYear"
  | "securityCodeThreeDigits"
  | "securityCodeFourDigits"
  | "password";

export const PLACEHOLDER_FIELDS: [PlaceholderKey, string, string][] = [
  ["holderName", "holderName", "J. Smith"],
  ["cardNumber", "cardNumber", "1234 5678 9012 3456"],
  ["expiryDate", "expiryDate", "MM/YY"],
  ["expiryMonth", "expiryMonth", "MM"],
  ["expiryYear", "expiryYear", "YY"],
  ["securityCodeThreeDigits", "securityCodeThreeDigits", "123"],
  ["securityCodeFourDigits", "securityCodeFourDigits", "1234"],
  ["password", "password", "Korean cards only"],
];

export interface CardOptions {
  hasHolderName: boolean;
  holderNameRequired: boolean;
  positionHolderNameOnTop: boolean;
  holderNamePrefill: string;
  hideCVC: boolean;
  maskSecurityCode: boolean;
  placeholders: Partial<Record<PlaceholderKey, string>>;
  billingAddressRequired: boolean;
  billingAddressMode: BillingAddressMode;
  billingAddressAllowedCountries: string[];
  billingAddressRequiredFields: string[];
  autoFocus: boolean;
  keypadFix: boolean;
  legacyInputMode: boolean;
  disableIOSArrowKeys: boolean;
  exposeExpiryDate: boolean;
  minimumExpiryDate: string;
  socialSecurityNumberMode: SocialSecurityNumberMode;
  showInstallmentAmounts: boolean;
  disclaimerEnabled: boolean;
  disclaimerMessage: string;
  disclaimerLinkText: string;
  disclaimerLink: string;
}

export const DEFAULT_CARD: CardOptions = {
  hasHolderName: true,
  holderNameRequired: true,
  positionHolderNameOnTop: false,
  holderNamePrefill: "",
  hideCVC: false,
  maskSecurityCode: false,
  placeholders: {},
  billingAddressRequired: false,
  billingAddressMode: "full",
  billingAddressAllowedCountries: [],
  billingAddressRequiredFields: [],
  autoFocus: true,
  keypadFix: true,
  legacyInputMode: false,
  disableIOSArrowKeys: true,
  exposeExpiryDate: false,
  minimumExpiryDate: "",
  socialSecurityNumberMode: "auto",
  showInstallmentAmounts: false,
  disclaimerEnabled: false,
  disclaimerMessage: "",
  disclaimerLinkText: "",
  disclaimerLink: "",
};

// Adyen's own DisclaimerMessage component silently renders nothing at all
// (not even the message text) unless every url passed to it is a valid
// http(s) URL, an empty or missing link string means the whole disclaimer
// disappears, message included. Guard against sending a config that would
// silently vanish.
export function isValidHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isValidExpiryDate(value: string): boolean {
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(value);
}

function disclaimerMessageField(card: CardOptions) {
  if (!card.disclaimerEnabled || !card.disclaimerMessage || !isValidHttpUrl(card.disclaimerLink)) {
    return {};
  }
  return {
    disclaimerMessage: {
      message: card.disclaimerMessage,
      linkText: card.disclaimerLinkText,
      link: card.disclaimerLink,
    },
  };
}

function placeholdersField(card: CardOptions) {
  const set = Object.entries(card.placeholders).filter(([, value]) => value);
  return set.length > 0 ? { placeholders: Object.fromEntries(set) } : {};
}

/** Options that apply to a re-entered CVC as much as to a full card form. */
function sharedFieldOptions(styles: SecureStyles, card: CardOptions) {
  return {
    styles: secureStyleObject(styles),
    hideCVC: card.hideCVC,
    maskSecurityCode: card.maskSecurityCode,
    autoFocus: card.autoFocus,
    keypadFix: card.keypadFix,
    legacyInputMode: card.legacyInputMode,
    disableIOSArrowKeys: card.disableIOSArrowKeys,
    ...placeholdersField(card),
    ...disclaimerMessageField(card),
  };
}

export function cardConfigObject(styles: SecureStyles, card: CardOptions, country: string) {
  const upperCountry = country.toUpperCase();
  return {
    ...sharedFieldOptions(styles, card),
    hasHolderName: card.hasHolderName,
    holderNameRequired: card.hasHolderName && card.holderNameRequired,
    positionHolderNameOnTop: card.positionHolderNameOnTop,
    ...(card.hasHolderName && card.holderNamePrefill
      ? { data: { holderName: card.holderNamePrefill } }
      : {}),
    billingAddressRequired: card.billingAddressRequired,
    ...(card.billingAddressRequired
      ? {
        billingAddressMode: card.billingAddressMode,
        ...(card.billingAddressAllowedCountries.length > 0
          ? { billingAddressAllowedCountries: card.billingAddressAllowedCountries }
          : {}),
        ...(card.billingAddressRequiredFields.length > 0
          ? { billingAddressRequiredFields: card.billingAddressRequiredFields }
          : {}),
      }
      : {}),
    exposeExpiryDate: card.exposeExpiryDate,
    ...(isValidExpiryDate(card.minimumExpiryDate)
      ? { minimumExpiryDate: card.minimumExpiryDate }
      : {}),
    ...(SOCIAL_SECURITY_NUMBER_COUNTRIES.includes(upperCountry)
      ? { configuration: { socialSecurityNumberMode: card.socialSecurityNumberMode } }
      : {}),
    // installmentOptions itself is NOT set here: for the Sessions flow, Adyen
    // only honors the installment plan baked into the session token at
    // creation time (sent server-side in /api/styling/session, automatically
    // for BR/MX/JP), a client-side override here is silently ignored.
    // showInstallmentAmounts is a pure Component display toggle, so it's
    // still set client-side.
    ...(INSTALLMENT_COUNTRIES.includes(upperCountry)
      ? { showInstallmentAmounts: card.showInstallmentAmounts }
      : {}),
  };
}

// storedCard only ever re-collects a CVC, it never renders a holder name,
// billing address or social security number field. Applying
// holderNameRequired/billingAddressRequired to it anyway makes the
// Component report isValid: false with no visible field to fix, so
// clicking "Pay" on a saved card silently does nothing. Everything that
// applies to the CVC field it does render is forwarded.
export function storedCardConfigObject(styles: SecureStyles, card: CardOptions) {
  return sharedFieldOptions(styles, card);
}

/* -------------------------------------------------------------------------- */
/* Wallets: the buttons Apple, Google and PayPal render themselves            */
/* -------------------------------------------------------------------------- */

/**
 * A wallet button is drawn by the provider, not by Adyen, so none of the CSS
 * or the secured-field styles above reach it. Each vendor exposes its own
 * small set of knobs instead, and these are the ones that change what you can
 * see, the rest are merchant identifiers and flow callbacks.
 *
 * Values come from ApplePayConfiguration / GooglePayConfiguration /
 * PayPalConfiguration in @adyen/adyen-web 6.46.0.
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
export const APPLE_PAY_BUTTON_COLORS: ApplePayButtonColor[] = [
  "black",
  "white",
  "white-outline",
];

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
  return Object.entries(wallets)
    .filter(([key, value]) => key.startsWith(prefix) && value !== "" && value !== false)
    .length;
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

/* -------------------------------------------------------------------------- */
/* Themes                                                                     */
/* -------------------------------------------------------------------------- */

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

export function dropinProps(
  native: NativeOptions,
  styles: SecureStyles,
  card: CardOptions,
  country: string,
  wallets: WalletOptions,
) {
  return {
    openFirstPaymentMethod: native.openFirstPaymentMethod,
    openFirstStoredPaymentMethod: native.openFirstStoredPaymentMethod,
    ...(native.openPaymentMethodType
      ? { openPaymentMethod: { type: native.openPaymentMethodType } }
      : {}),
    instantPaymentTypes: native.instantPaymentTypes,
    showPaymentMethods: native.showPaymentMethods,
    showStoredPaymentMethods: native.showStoredPaymentMethods,
    showRadioButton: native.showRadioButton,
    disableFinalAnimation: native.disableFinalAnimation,
    paymentMethodsConfiguration: {
      card: cardConfigObject(styles, card, country),
      storedCard: storedCardConfigObject(styles, card),
      ...walletConfigObjects(wallets),
    },
  };
}

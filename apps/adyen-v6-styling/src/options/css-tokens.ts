// The CSS custom properties adyen.css reads, and the stylesheet the panel exports.
import { ADYEN_WEB_VERSION, type ControlKind, type ControlSpec, FONT_WEIGHTS } from "./controls.ts";
import { applePayCssBlock, type WalletOptions } from "./wallets.ts";

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
export type CssTokenGroup = (typeof CSS_TOKEN_GROUPS)[number];

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
  ...tokenGroup(
    "Radius & borders",
    "border-",
    [
      ["border-radius-xs", "2px"],
      ["border-radius-s", "4px"],
      ["border-radius-m", "8px"],
      ["border-radius-l", "12px"],
      ["border-width-s", "1px", { max: 12 }],
      ["border-width-l", "3px", { max: 12 }],
    ],
    { max: 32 },
  ),
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
  ...tokenGroup(
    "Spacing",
    "",
    [
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
    ],
    { kind: "range", unit: "px", min: 0, max: 96, step: 1 },
  ),
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
    ["animation-duration-slow", "0.25s"],
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
  return CSS_TOKEN_SPECS.filter((spec) => !group || spec.group === group).filter(
    (spec) => tokens[spec.token],
  ).length;
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
  return (
    CSS_RULE_SPECS.filter(({ key }) => rules[key]).length +
    (rules.uppercaseButton ? 1 : 0) +
    (rules.compactMethods ? 1 : 0)
  );
}

const NOTHING_SET = "/* Nothing overridden yet, the Drop-in runs Adyen's own values. */";

const CSS_HEADER = `/* Adyen Web ${ADYEN_WEB_VERSION}, TEST playground overrides.
 * Import after @adyen/adyen-web/styles/adyen.css.
 */
`;

export function cssText(tokens: CssTokens, rules: CssRules, wallets?: WalletOptions): string {
  const blocks: string[] = [];
  const overrides = CSS_TOKEN_SPECS.filter((spec) => tokens[spec.token]).map(
    (spec) => `  --adyen-sdk-${spec.token}: ${tokens[spec.token]};`,
  );
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

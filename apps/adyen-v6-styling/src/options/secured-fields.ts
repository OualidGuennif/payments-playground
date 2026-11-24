// Secured fields: the styles object Adyen hands to its card iframes.
import { type ControlSpec, FONT_SMOOTHING, FONT_WEIGHTS } from "./controls.ts";

/**
 * The card number, expiry date and security code live in Adyen-hosted
 * iframes, so no page CSS can reach them: they are styled exclusively through
 * this object, and only these four states exist.
 */
export const SECURE_STATES = ["base", "placeholder", "error", "validated"] as const;
export type SecureState = (typeof SECURE_STATES)[number];

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
export type SecureGroup = (typeof SECURE_GROUPS)[number];

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
  return SECURE_PROPERTY_SPECS.filter((spec) => !group || spec.group === group).filter(
    (spec) => styles[state][spec.property],
  ).length;
}

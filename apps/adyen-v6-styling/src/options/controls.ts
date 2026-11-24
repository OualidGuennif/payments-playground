/**
 * Every native option this playground exposes, one file per area in src/options.
 *
 * The lists are not a hand-picked subset: the secured-field properties are
 * StyleDefinitions, the card/Drop-in options are CardConfiguration and
 * DropinConfiguration (all of them that a merchant is allowed to set), and the
 * CSS custom properties are the ones actually shipped in adyen.css, all read
 * from @adyen/adyen-web 6.48.1. Re-check them on every SDK bump.
 */
// The Adyen Web version these catalogues were read from, and the shape of one control.

export const ADYEN_WEB_VERSION = "6.48.1";
export const ADYEN_CSS_URL = `https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/${ADYEN_WEB_VERSION}/adyen.css`;

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

export const FONT_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
export const FONT_SMOOTHING = ["antialiased", "subpixel-antialiased", "none"];

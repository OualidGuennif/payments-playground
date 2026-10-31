// Spec: knowledge/components/adyen-v6-styling.md
import { detectCountryFromLanguages, FALLBACK_COUNTRY } from "@suite/platform/markets.ts";
import { INSTALLMENT_COUNTRIES } from "@suite/ui/paymentMethods.ts";
import { DEFAULT_CARD } from "./adyenOptions.ts";
import type { CardOptions } from "./adyenOptions.ts";

/**
 * The panel's static tables and the two guesses derived from them: which
 * markets and locales it offers, the group-open defaults and the hint strings
 * shared by more than one group. Pure data, no state and no DOM.
 */

export const COUNTRIES = [
  ["FR", "France"],
  ["NL", "Netherlands"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["DE", "Germany"],
  ["BE", "Belgium"],
  ["CA", "Canada"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["CH", "Switzerland"],
  ["AT", "Austria"],
  ["PT", "Portugal"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["PL", "Poland"],
  ["CZ", "Czech Republic"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["SG", "Singapore"],
  ["HK", "Hong Kong"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["CN", "China"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["MY", "Malaysia"],
  ["TH", "Thailand"],
  ["PH", "Philippines"],
  ["VN", "Vietnam"],
  ["BR", "Brazil"],
  ["MX", "Mexico"],
  ["ZA", "South Africa"],
  ["KE", "Kenya"],
  ["AE", "United Arab Emirates"],
] as const;

export const LOCALES = [
  ["en-GB", "English"],
  ["en-US", "English"],
  ["fr-FR", "Français"],
  ["nl-NL", "Nederlands"],
  ["nl-BE", "Nederlands"],
  ["zh-CN", "中文"],
  ["de-DE", "Deutsch"],
  ["de-AT", "Deutsch"],
  ["de-CH", "Deutsch"],
  ["es-ES", "Español"],
  ["es-MX", "Español"],
  ["it-IT", "Italiano"],
  ["pt-PT", "Português"],
  ["pt-BR", "Português"],
  ["en-CA", "English"],
  ["en-AU", "English"],
  ["en-NZ", "English"],
  ["sv-SE", "Svenska"],
  ["nb-NO", "Norsk"],
  ["da-DK", "Dansk"],
  ["fi-FI", "Suomi"],
  ["pl-PL", "Polski"],
  ["cs-CZ", "Čeština"],
  ["en-SG", "English"],
  ["zh-HK", "中文"],
  ["ja-JP", "日本語"],
  ["ko-KR", "한국어"],
  ["en-IN", "English"],
  ["id-ID", "Bahasa Indonesia"],
  ["en-MY", "English"],
  ["th-TH", "ไทย"],
  ["en-PH", "English"],
  ["vi-VN", "Tiếng Việt"],
  ["en-ZA", "English"],
  ["en-KE", "English"],
  ["ar-AE", "العربية"],
] as const;

// The market selector keeps the most-used markets on top, where you pick one
// country. This list is the opposite job, finding a country among all of
// them, so it is alphabetical.
export const COUNTRY_ITEMS: [string, string][] = COUNTRIES
  .map(([code, name]): [string, string] => [code, name])
  .sort((a, b) => a[1].localeCompare(b[1]));

export function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(
    ...countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

/**
 * Market to open on, guessed from the browser's language preferences and
 * narrowed to the countries this playground actually offers. Returns the
 * shared European fallback during SSR (no navigator) or when the guess isn't
 * one of the offered markets.
 */
export function detectInitialCountry(): string {
  if (typeof navigator === "undefined") return FALLBACK_COUNTRY;
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  const guess = detectCountryFromLanguages(languages, FALLBACK_COUNTRY);
  return COUNTRIES.some(([code]) => code === guess) ? guess : FALLBACK_COUNTRY;
}

export interface Bootstrap {
  clientKey: string | null;
  profile: { isConfigured: boolean; missingFields: string[] };
}

export interface SessionResponse {
  correlationId: string;
  session: { id: string; sessionData: string };
}

export interface AvailableMethod {
  type: string;
  name: string;
}

export interface Mounted {
  unmount(): void;
}

/**
 * Card defaults for a given market. Two of them only make sense once the
 * market is known, so they are derived here rather than frozen into
 * DEFAULT_CARD, and reset goes through the same function, so it restores the
 * market you are on rather than the one you arrived on.
 */
export function cardDefaultsFor(country: string): CardOptions {
  return {
    ...DEFAULT_CARD,
    showInstallmentAmounts: INSTALLMENT_COUNTRIES.includes(country),
    // Starts on the market being previewed: an address form that accepts every
    // country Adyen supports is rarely what you are demoing, and this is the
    // one country the reader has already told us about.
    billingAddressAllowedCountries: [country],
  };
}

// Every group starts closed: the panel is a list of what you *can* change, and
// opening one is the reader's choice. Anything open by default is just noise
// between them and the section they came for.
export const DEFAULT_OPEN_GROUPS: Record<string, boolean> = {};

export const PLACEHOLDERS_HINT = "placeholders, Adyen ships localised placeholders; anything " +
  "set here replaces them.";

export const RULES_HINT = "Not recommended. No design token covers these, so they reach into " +
  "Adyen's own class names, private API that can be renamed in any release, with no " +
  "warning and no deprecation. A checkout styled this way can break on an SDK upgrade. " +
  "Use the theme tokens above wherever one exists.";

export const WALLET_HINT =
  "The provider draws this button itself, so neither the field styles nor " +
  "the CSS theme reach it, only its own options do.";

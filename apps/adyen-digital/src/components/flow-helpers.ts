// Spec: knowledge/components/adyen-digital.md
import {
  currencyForCountry,
  detectCountryFromLanguages,
  FALLBACK_COUNTRY,
  localeForCountry,
  ZERO_DECIMAL_CURRENCIES,
} from "@suite/platform/markets.ts";
import { type Theme } from "@suite/ui/theme.ts";
import { type Flow } from "./flows.ts";
// field() below reads strings only; orders and balances are objects and numbers.
import { field as valueAt } from "./read.ts";

export interface PublicProfile {
  id: string;
  label: string;
  isConfigured: boolean;
  missingFields: string[];
  merchantAccount?: string;
}

export interface AvailableComponent {
  type: string;
  name: string;
}

export interface Bootstrap {
  profile: PublicProfile;
  profiles: PublicProfile[];
  clientKey: string | null;
  webhookUrl: string;
}

export interface StoredMethod {
  id: string;
  brand?: string;
  lastFour?: string;
  expiryMonth?: string;
  expiryYear?: string;
  name?: string;
  supportedRecurringProcessingModels?: string[];
}

export type RecurringModel = "UnscheduledCardOnFile" | "Subscription";

export const MARKETS = [
  ["AE", "United Arab Emirates"],
  ["AT", "Austria"],
  ["AU", "Australia"],
  ["BE", "Belgium"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CH", "Switzerland"],
  ["CN", "China"],
  ["CZ", "Czech Republic"],
  ["DE", "Germany"],
  ["DK", "Denmark"],
  ["ES", "Spain"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GB", "United Kingdom"],
  ["HK", "Hong Kong"],
  ["ID", "Indonesia"],
  ["IN", "India"],
  ["IT", "Italy"],
  ["JP", "Japan"],
  ["KE", "Kenya"],
  ["KR", "South Korea"],
  ["MX", "Mexico"],
  ["MY", "Malaysia"],
  ["NL", "Netherlands"],
  ["NO", "Norway"],
  ["NZ", "New Zealand"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["SE", "Sweden"],
  ["SG", "Singapore"],
  ["TH", "Thailand"],
  ["US", "United States"],
  ["VN", "Vietnam"],
  ["ZA", "South Africa"],
] as const;

// Every market's own locale/currency, so both dropdowns cover the same set
// the per-country defaults are actually drawn from.
export const LOCALE_OPTIONS = [...new Set(MARKETS.map(([code]) => localeForCountry(code)))].sort();
export const CURRENCY_OPTIONS = [...new Set(MARKETS.map(([code]) => currencyForCountry(code)))]
  .sort();

export const VALIDITY_OPTIONS: Array<[number, string]> = [
  [1, "1 hour"],
  [24, "24 hours"],
  [24 * 7, "7 days"],
  [24 * 30, "30 days"],
  [24 * 70, "70 days (maximum)"],
];

/**
 * Market to open on: pay-by-link keeps its NL default, everything else is
 * guessed from the browser's languages and falls back to a European market.
 * Returns the fallback during SSR, where there is no navigator.
 */
export function detectInitialCountry(flow: Flow): string {
  if (flow === "pay-by-link" || typeof navigator === "undefined") return FALLBACK_COUNTRY;
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  const guess = detectCountryFromLanguages(languages, FALLBACK_COUNTRY);
  return MARKETS.some(([code]) => code === guess) ? guess : FALLBACK_COUNTRY;
}

// Reuses Adyen's own shipped CSS classes (imported globally as adyen.css) for
// field box sizing/focus states; only the wrapper, status and hint are ours.
export const CUSTOM_CARD_MARKUP = `
  <div class="custom-card-form">
    <div class="adyen-checkout__field">
      <label class="adyen-checkout__label" for="customCardHolderName">Cardholder name</label>
      <div class="adyen-checkout__input-wrapper">
        <input
          id="customCardHolderName"
          class="adyen-checkout__input"
          autocomplete="cc-name"
          placeholder="John Doe"
        />
      </div>
    </div>
    <div class="adyen-checkout__field">
      <label class="adyen-checkout__label">Card number</label>
      <div class="adyen-checkout__input-wrapper">
        <span class="adyen-checkout__input" data-cse="encryptedCardNumber"></span>
      </div>
    </div>
    <div class="adyen-checkout__field adyen-checkout__field--two-in-one">
      <div class="adyen-checkout__field">
        <label class="adyen-checkout__label">Expiry date</label>
        <div class="adyen-checkout__input-wrapper">
          <span class="adyen-checkout__input" data-cse="encryptedExpiryDate"></span>
        </div>
      </div>
      <div class="adyen-checkout__field">
        <label class="adyen-checkout__label">CVC</label>
        <div class="adyen-checkout__input-wrapper">
          <span class="adyen-checkout__input" data-cse="encryptedSecurityCode"></span>
        </div>
      </div>
    </div>
    <p class="custom-card-status" data-role="status" aria-live="polite"></p>
    <button
      type="button"
      class="adyen-checkout__button adyen-checkout__button--pay custom-card-submit"
      data-role="submit"
      disabled
    >
      Pay now
    </button>
  </div>
`;

/**
 * Secured fields render inside Adyen's iframes, out of reach of this page's
 * CSS: in dark mode their text colours have to be passed in as `styles`.
 */
export function securedFieldStyles(theme: Theme): Record<string, unknown> | undefined {
  if (theme !== "dark") return undefined;
  return {
    base: { color: "#eef1f6", caretColor: "#eef1f6" },
    placeholder: { color: "#7b8493" },
    error: { color: "#ff7b88" },
  };
}

// Adyen accepts 5 refused payments in one session; the next payments call
// answers 422 "14_0422" whatever the card (seen on TEST, 2026-10-16).
export const SESSION_REFUSAL_LIMIT = 5;

/** Adyen's answer when a session takes no more payments: closed (0422) or expired (0423). */
export function closesSession(failure: unknown): boolean {
  const errorCode = valueAt(failure, "cause.errorCode");
  return errorCode === "14_0422" || errorCode === "14_0423";
}

export function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(
    ...countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

export function minorExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

// This is a TEST playground: sdkData, sessionData and other frontend callback
// payloads are shown in full; nothing here is a real credential, and
// truncating them only hides useful debug information.
export function recordSafe(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth limited]";
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => recordSafe(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = recordSafe(entry, depth + 1);
  }
  return output;
}

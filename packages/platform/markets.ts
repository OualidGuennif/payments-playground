/**
 * Single source of truth for "what does a checkout look like in country X":
 * its settlement currency, its shopper locale, and a presentable default
 * order amount. Shared by every app so the styling playground and the
 * digital workbench can't drift apart on what EUR/JPY/BR means.
 */

/** Currency each market settles in, for all countries in addresses.ts. */
const MARKET_CURRENCY: Record<string, string> = {
  AE: "AED",
  AT: "EUR",
  AU: "AUD",
  BE: "EUR",
  BR: "BRL",
  CA: "CAD",
  CH: "CHF",
  CN: "CNY",
  CZ: "CZK",
  DE: "EUR",
  DK: "DKK",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GB: "GBP",
  HK: "HKD",
  ID: "IDR",
  IN: "INR",
  IT: "EUR",
  JP: "JPY",
  KE: "KES",
  KR: "KRW",
  MX: "MXN",
  MY: "MYR",
  NL: "EUR",
  NO: "NOK",
  NZ: "NZD",
  PH: "PHP",
  PL: "PLN",
  PT: "EUR",
  SE: "SEK",
  SG: "SGD",
  TH: "THB",
  US: "USD",
  VN: "VND",
  ZA: "ZAR",
};

/** Shopper locale each market defaults to. */
const MARKET_LOCALE: Record<string, string> = {
  AE: "ar-AE",
  AT: "de-AT",
  AU: "en-AU",
  BE: "nl-BE",
  BR: "pt-BR",
  CA: "en-CA",
  CH: "de-CH",
  CN: "zh-CN",
  CZ: "cs-CZ",
  DE: "de-DE",
  DK: "da-DK",
  ES: "es-ES",
  FI: "fi-FI",
  FR: "fr-FR",
  GB: "en-GB",
  HK: "zh-HK",
  ID: "id-ID",
  IN: "en-IN",
  IT: "it-IT",
  JP: "ja-JP",
  KE: "en-KE",
  KR: "ko-KR",
  MX: "es-MX",
  MY: "en-MY",
  NL: "nl-NL",
  NO: "nb-NO",
  NZ: "en-NZ",
  PH: "en-PH",
  PL: "pl-PL",
  PT: "pt-PT",
  SE: "sv-SE",
  SG: "en-SG",
  TH: "th-TH",
  US: "en-US",
  VN: "vi-VN",
  ZA: "en-ZA",
};

/**
 * Currencies with no minor unit, their Adyen "minor units" value equals the
 * major amount (¥110 is `{value: 110}`, not 11000).
 */
export const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "IDR"]);

/** The reference order value every market's default is modelled on. */
const REFERENCE_MAJOR_AMOUNT = 109.99;

/**
 * Default order amount per currency, in MAJOR units (what a shopper reads:
 * 699 means "699", not "6.99"). `defaultAmountForCurrency` converts to Adyen
 * minor units, never put minor units in this table.
 *
 * Not an FX conversion: each value is the reference amount rounded to
 * something that looks like a real price tag locally, so the playground never
 * shows "¥109.99" or an absurd "R$5.49".
 */
const DEFAULT_MAJOR_AMOUNT: Record<string, number> = {
  // Zero-decimal currencies, rounded to a natural round figure.
  JPY: 17_000,
  KRW: 150_000,
  VND: 2_900_000,
  IDR: 1_900_000,
  // Two-decimal currencies whose scale is far from the euro.
  INR: 9_999,
  CZK: 2_799,
  PLN: 499,
  THB: 3_999,
  PHP: 5_999,
  MXN: 1_999,
  BRL: 699,
  ZAR: 1_999,
  KES: 14_999,
  HKD: 899,
  CNY: 799,
  AED: 399,
  DKK: 799,
  SEK: 1_199,
  NOK: 1_199,
};

/** The market used whenever detection is inconclusive, kept in the EU. */
export const FALLBACK_COUNTRY = "NL";

export function currencyForCountry(countryCode: string): string {
  return MARKET_CURRENCY[countryCode.toUpperCase()] ?? "EUR";
}

export function localeForCountry(countryCode: string): string {
  return MARKET_LOCALE[countryCode.toUpperCase()] ?? "en-GB";
}

export function isSupportedMarket(countryCode: string): boolean {
  return countryCode.toUpperCase() in MARKET_CURRENCY;
}

/** Converts a major (human-readable) amount to Adyen minor units. */
export function toMinorUnits(major: number, currency: string): number {
  return Math.round(ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? major : major * 100);
}

/** Default order amount for a currency, in Adyen minor units. */
export function defaultAmountForCurrency(currency: string): number {
  const upper = currency.toUpperCase();
  // Currencies not in the table are euro-scale (USD, GBP, CHF, CAD, AUD,
  // SGD, NZD...), where the reference amount already reads as a real price.
  const major = DEFAULT_MAJOR_AMOUNT[upper] ?? REFERENCE_MAJOR_AMOUNT;
  return toMinorUnits(major, upper);
}

export function defaultAmountForCountry(countryCode: string): number {
  return defaultAmountForCurrency(currencyForCountry(countryCode));
}

/**
 * Best-effort market guess from BCP-47 language tags (`navigator.languages`
 * in the browser, or an `Accept-Language` header server-side), preferring a
 * region subtag we actually support. Falls back to FALLBACK_COUNTRY rather
 * than guessing, so an unknown visitor always lands on a European market.
 */
export function detectCountryFromLanguages(
  languages: readonly string[],
  fallback = FALLBACK_COUNTRY,
): string {
  for (const tag of languages) {
    // "fr-FR", "fr-FR;q=0.9" and "nl_BE" all yield their region subtag.
    const region = tag.split(";")[0].trim().replace("_", "-").split("-")[1];
    if (region && isSupportedMarket(region)) return region.toUpperCase();
  }
  // No usable region: fall back to a bare language whose home market we
  // support, so "fr" still reaches France rather than the generic default.
  const LANGUAGE_HOME: Record<string, string> = {
    fr: "FR",
    nl: "NL",
    de: "DE",
    es: "ES",
    it: "IT",
    pt: "PT",
    en: "GB",
    sv: "SE",
    nb: "NO",
    no: "NO",
    da: "DK",
    fi: "FI",
    pl: "PL",
    cs: "CZ",
    ja: "JP",
    ko: "KR",
    zh: "CN",
    th: "TH",
    id: "ID",
    vi: "VN",
    ar: "AE",
  };
  for (const tag of languages) {
    const language = tag.split(";")[0].trim().replace("_", "-").split("-")[0].toLowerCase();
    const home = LANGUAGE_HOME[language];
    if (home) return home;
  }
  return fallback;
}

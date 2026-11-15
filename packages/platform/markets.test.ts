import { test } from "bun:test";
import { assert, assertEquals } from "../../testing/assert.ts";
import {
  currencyForCountry,
  defaultAmountForCurrency,
  detectCountryFromLanguages,
  FALLBACK_COUNTRY,
  localeForCountry,
  ZERO_DECIMAL_CURRENCIES,
} from "./markets.ts";

test("default amounts land in a believable price range for every market", () => {
  // Regression guard: the amount table is in MAJOR units and converted on
  // read. Storing minor units there once produced R$5.49 and ₹89.99 orders.
  const EXPECTED_MAJOR_RANGE: Record<string, [number, number]> = {
    EUR: [50, 500],
    USD: [50, 500],
    GBP: [50, 500],
    CHF: [50, 500],
    BRL: [200, 2_000],
    MXN: [500, 5_000],
    INR: [2_000, 30_000],
    JPY: [5_000, 50_000],
    KRW: [50_000, 500_000],
    VND: [500_000, 10_000_000],
    IDR: [500_000, 10_000_000],
    CZK: [1_000, 10_000],
    PLN: [200, 2_000],
    THB: [1_000, 10_000],
    PHP: [2_000, 20_000],
    ZAR: [500, 5_000],
    KES: [5_000, 50_000],
    HKD: [300, 3_000],
    CNY: [300, 3_000],
    AED: [150, 1_500],
    DKK: [300, 3_000],
    SEK: [500, 5_000],
    NOK: [500, 5_000],
  };

  for (const [currency, [min, max]] of Object.entries(EXPECTED_MAJOR_RANGE)) {
    const minor = defaultAmountForCurrency(currency);
    const major = ZERO_DECIMAL_CURRENCIES.has(currency) ? minor : minor / 100;
    assert(
      major >= min && major <= max,
      `${currency} default is ${major} major units, expected ${min}–${max}`,
    );
    assert(Number.isInteger(minor), `${currency} minor units must be an integer, got ${minor}`);
  }
});

test("zero-decimal currencies are never given fractional minor units", () => {
  for (const currency of ZERO_DECIMAL_CURRENCIES) {
    const minor = defaultAmountForCurrency(currency);
    assert(Number.isInteger(minor), `${currency} produced ${minor}`);
    // minor === major here, so a euro-scale value would mean a ~1 EUR order.
    assert(minor >= 1_000, `${currency} default ${minor} is implausibly small`);
  }
});

test("every market resolves a currency and a locale", () => {
  for (const country of ["FR", "NL", "US", "BR", "JP", "MX", "KE", "AE"]) {
    assert(/^[A-Z]{3}$/.test(currencyForCountry(country)), country);
    assert(/^[a-z]{2}-[A-Z]{2}$/.test(localeForCountry(country)), country);
  }
});

test("country detection prefers a supported region, then language home", () => {
  assertEquals(detectCountryFromLanguages(["fr-FR", "en-US"]), "FR");
  assertEquals(detectCountryFromLanguages(["en-US;q=0.9"]), "US");
  assertEquals(detectCountryFromLanguages(["nl_BE"]), "BE");
  // Region we don't serve falls through to the language's home market.
  assertEquals(detectCountryFromLanguages(["fr-CI"]), "FR");
  // Nothing usable stays in Europe rather than guessing.
  assertEquals(detectCountryFromLanguages(["xx"]), FALLBACK_COUNTRY);
  assertEquals(detectCountryFromLanguages([]), FALLBACK_COUNTRY);
});

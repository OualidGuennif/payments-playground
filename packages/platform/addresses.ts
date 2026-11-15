import type { Address, AddressPair } from "./types.ts";

type CompactAddress = [
  street: string,
  houseNumberOrName: string,
  postalCode: string,
  city: string,
  stateOrProvince?: string,
];

type CompactDataset = [billing: CompactAddress, delivery: CompactAddress];

/**
 * Synthetic TEST-only address fixtures. The selectable countries in the
 * playground are derived from this object, so every exposed country has both
 * a billing and delivery fixture.
 */
const FIXTURES: Record<string, CompactDataset> = {
  AE: [
    ["Sheikh Zayed Road", "1", "00000", "Dubai"],
    ["Corniche Road", "20", "00000", "Abu Dhabi"],
  ],
  AT: [
    ["Kaerntner Strasse", "12", "1010", "Vienna"],
    ["Mariahilfer Strasse", "45", "1070", "Vienna"],
  ],
  AU: [
    ["George Street", "200", "2000", "Sydney", "NSW"],
    ["Collins Street", "120", "3000", "Melbourne", "VIC"],
  ],
  BE: [
    ["Rue de la Loi", "16", "1000", "Brussels"],
    ["Avenue Louise", "120", "1050", "Brussels"],
  ],
  BR: [
    ["Avenida Paulista", "1000", "01310-100", "Sao Paulo", "SP"],
    ["Rua da Assembleia", "10", "20011-901", "Rio de Janeiro", "RJ"],
  ],
  CA: [
    ["King Street West", "100", "M5X 1A9", "Toronto", "ON"],
    ["West Georgia Street", "700", "V7Y 1K8", "Vancouver", "BC"],
  ],
  CH: [
    ["Bahnhofstrasse", "20", "8001", "Zurich"],
    ["Rue du Rhone", "50", "1204", "Geneva"],
  ],
  CN: [
    ["Jianguomen Outer Street", "1", "100004", "Beijing", "BJ"],
    ["Nanjing West Road", "100", "200003", "Shanghai", "SH"],
  ],
  CZ: [
    ["Vaclavske namesti", "1", "11000", "Prague"],
    ["Na Prikope", "12", "11000", "Prague"],
  ],
  DE: [
    ["Friedrichstrasse", "100", "10117", "Berlin"],
    ["Kurfurstendamm", "21", "10719", "Berlin"],
  ],
  DK: [
    ["Kongens Nytorv", "1", "1050", "Copenhagen"],
    ["Vesterbrogade", "20", "1620", "Copenhagen"],
  ],
  ES: [
    ["Gran Via", "30", "28013", "Madrid"],
    ["Passeig de Gracia", "50", "08007", "Barcelona"],
  ],
  FI: [
    ["Mannerheimintie", "10", "00100", "Helsinki"],
    ["Aleksanterinkatu", "15", "00100", "Helsinki"],
  ],
  FR: [
    ["Avenue Daumesnil", "6", "75012", "Paris"],
    ["Rue de Rivoli", "99", "75001", "Paris"],
  ],
  GB: [
    ["Baker Street", "221B", "NW16XE", "London"],
    ["Regent Street", "100", "W1B5SR", "London"],
  ],
  HK: [
    ["Queens Road Central", "99", "000000", "Hong Kong"],
    ["Nathan Road", "700", "000000", "Kowloon"],
  ],
  ID: [
    ["Jalan MH Thamrin", "10", "10340", "Jakarta"],
    ["Jalan Jenderal Sudirman", "25", "10220", "Jakarta"],
  ],
  IN: [
    ["Mahatma Gandhi Road", "20", "400001", "Mumbai", "MH"],
    ["Brigade Road", "45", "560001", "Bengaluru", "KA"],
  ],
  IT: [
    ["Via del Corso", "100", "00186", "Rome"],
    ["Via Torino", "40", "20123", "Milan"],
  ],
  JP: [
    ["Marunouchi", "1-1", "100-0005", "Tokyo"],
    ["Shibuya", "2-21", "150-0002", "Tokyo"],
  ],
  KE: [
    ["Kenyatta Avenue", "10", "00100", "Nairobi"],
    ["Waiyaki Way", "25", "00606", "Nairobi"],
  ],
  KR: [
    ["Sejong-daero", "110", "04524", "Seoul"],
    ["Teheran-ro", "152", "06236", "Seoul"],
  ],
  MX: [
    ["Avenida Paseo de la Reforma", "222", "06600", "Mexico City", "CMX"],
    ["Avenida Vallarta", "1500", "44110", "Guadalajara", "JAL"],
  ],
  MY: [
    ["Jalan Ampang", "50", "50450", "Kuala Lumpur"],
    ["Jalan Bukit Bintang", "120", "55100", "Kuala Lumpur"],
  ],
  NL: [
    ["Damrak", "1", "1012LG", "Amsterdam"],
    ["Keizersgracht", "100", "1015CV", "Amsterdam"],
  ],
  NO: [
    ["Karl Johans gate", "20", "0159", "Oslo"],
    ["Stortingsgata", "10", "0161", "Oslo"],
  ],
  NZ: [
    ["Queen Street", "100", "1010", "Auckland", "AUK"],
    ["Lambton Quay", "50", "6011", "Wellington", "WGN"],
  ],
  PH: [
    ["Ayala Avenue", "6750", "1226", "Makati"],
    ["Bonifacio High Street", "9", "1634", "Taguig"],
  ],
  PL: [
    ["Marszalkowska", "100", "00-026", "Warsaw"],
    ["Nowy Swiat", "20", "00-373", "Warsaw"],
  ],
  PT: [
    ["Avenida da Liberdade", "100", "1250-096", "Lisbon"],
    ["Rua Augusta", "120", "1100-053", "Lisbon"],
  ],
  SE: [
    ["Drottninggatan", "50", "11121", "Stockholm"],
    ["Hamngatan", "20", "11147", "Stockholm"],
  ],
  SG: [
    ["Raffles Place", "1", "048616", "Singapore"],
    ["Orchard Road", "250", "238905", "Singapore"],
  ],
  TH: [
    ["Sukhumvit Road", "100", "10110", "Bangkok"],
    ["Silom Road", "50", "10500", "Bangkok"],
  ],
  US: [
    ["Market Street", "1355", "94103", "San Francisco", "CA"],
    ["Madison Avenue", "350", "10017", "New York", "NY"],
  ],
  VN: [
    ["Nguyen Hue", "20", "700000", "Ho Chi Minh City"],
    ["Trang Tien", "15", "100000", "Hanoi"],
  ],
  ZA: [
    ["Long Street", "100", "8001", "Cape Town", "WC"],
    ["Rivonia Road", "135", "2196", "Johannesburg", "GP"],
  ],
};

export const SUPPORTED_COUNTRY_CODES = Object.freeze(Object.keys(FIXTURES).sort());
export const STATE_REQUIRED_COUNTRIES = new Set(["US", "CA"]);

export function normalizeCountryCode(value: unknown, fallback = "FR"): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : fallback;
}

function expand(compact: CompactAddress, country: string): Address {
  const [street, houseNumberOrName, postalCode, city, stateOrProvince] = compact;
  return {
    street,
    houseNumberOrName,
    postalCode,
    city,
    country,
    ...(stateOrProvince ? { stateOrProvince } : {}),
  };
}

function normalizedProvided(value: unknown): Partial<Address> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Partial<Address> = {};
  for (const key of [
    "street",
    "houseNumberOrName",
    "postalCode",
    "city",
    "country",
    "stateOrProvince",
    "firstName",
    "lastName",
  ] as const) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) output[key] = candidate.trim();
  }
  return output;
}

export function addressDataset(countryCode: unknown): AddressPair {
  const country = normalizeCountryCode(countryCode);
  const fixture = FIXTURES[country] ?? [
    ["Test Street", "1", "00000", "Test City"],
    ["Delivery Street", "2", "00000", "Test City"],
  ];
  return {
    billingAddress: expand(fixture[0], country),
    deliveryAddress: expand(fixture[1], country),
  };
}

export function buildCheckoutAddresses(
  input: { countryCode?: unknown; billingAddress?: unknown; deliveryAddress?: unknown } = {},
): AddressPair {
  const selectedCountry = normalizeCountryCode(input.countryCode);
  const providedBilling = normalizedProvided(input.billingAddress);
  const providedDelivery = normalizedProvided(input.deliveryAddress);
  const billingCountry = normalizeCountryCode(providedBilling.country, selectedCountry);
  const deliveryCountry = normalizeCountryCode(providedDelivery.country, selectedCountry);
  const billing = { ...addressDataset(billingCountry).billingAddress, ...providedBilling };
  const delivery = { ...addressDataset(deliveryCountry).deliveryAddress, ...providedDelivery };
  billing.country = billingCountry;
  delivery.country = deliveryCountry;

  if (STATE_REQUIRED_COUNTRIES.has(billingCountry) && !billing.stateOrProvince) {
    throw new Error(`stateOrProvince is required for billingAddress in ${billingCountry}.`);
  }
  if (STATE_REQUIRED_COUNTRIES.has(deliveryCountry) && !delivery.stateOrProvince) {
    throw new Error(`stateOrProvince is required for deliveryAddress in ${deliveryCountry}.`);
  }
  return { billingAddress: billing, deliveryAddress: delivery };
}

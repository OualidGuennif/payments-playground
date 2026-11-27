// Spec: knowledge/components/agentic-storefront.md
// The store's seasons start a month ahead of the calendar's (ADR-020). The day is read in UTC so
// the server's page, the browser and the tests name the same season.

export type SeasonId = "winter" | "spring" | "summer" | "autumn";

export const SEASON_IDS: readonly SeasonId[] = ["winter", "spring", "summer", "autumn"];

export interface SeasonConfig {
  id: SeasonId;
  label: string;
  giftVariantId: string;
  giftTitle: string;
  shortGiftLabel: string;
  giftImage: string;
  bannerTagline: string;
  bannerCompact: string;
}

const LABELS: Record<SeasonId, string> = {
  winter: "Winter",
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
};

function build(id: SeasonId): SeasonConfig {
  const label = LABELS[id];
  const giftVariantId = `velune-welcome-tote-${id}`;
  return {
    id,
    label,
    giftVariantId,
    giftTitle: `${label} Tote Bag Edition`,
    shortGiftLabel: `${label} Tote`,
    giftImage: `/api/art/${giftVariantId}.svg`,
    bannerTagline: `${label} Edition · Agentic Commerce Sandbox · 5% off & free ${label} Tote on your first order`,
    bannerCompact: `${label} Edition · Agentic Commerce Sandbox`,
  };
}

const SEASONS = Object.fromEntries(SEASON_IDS.map((id) => [id, build(id)])) as Record<
  SeasonId,
  SeasonConfig
>;

// Month and day as one number (21 November is 1121), so each boundary is one comparison and a
// leap day falls inside its season without a special case.
export function seasonFor(date: Date = new Date()): SeasonConfig {
  const md = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  if (md >= 1121 || md <= 220) return SEASONS.winter;
  if (md <= 520) return SEASONS.spring;
  if (md <= 820) return SEASONS.summer;
  return SEASONS.autumn;
}

export const seasonById = (id: SeasonId): SeasonConfig => SEASONS[id];

export const isSeasonId = (value: unknown): value is SeasonId =>
  typeof value === "string" && (SEASON_IDS as readonly string[]).includes(value);

const GIFT_ID = /^velune-welcome-tote-(winter|spring|summer|autumn)$/;

export const isWelcomeGiftVariantId = (id: string): boolean => GIFT_ID.test(id);

// The season a gift id names, or none: the art route serves only these four names.
export function seasonOfGift(id: string): SeasonId | undefined {
  const match = GIFT_ID.exec(id);
  return match ? (match[1] as SeasonId) : undefined;
}

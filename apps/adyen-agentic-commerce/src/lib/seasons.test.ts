import { describe, expect, test } from "bun:test";
import { isWelcomeGiftVariantId, seasonById, seasonFor, seasonOfGift } from "./seasons";

const on = (day: string) => seasonFor(new Date(`${day}T12:00:00Z`)).id;

describe("seasons", () => {
  test("seasons start on the 21st of the month before", () => {
    expect([on("2026-11-20"), on("2026-11-21")]).toEqual(["autumn", "winter"]);
    expect([on("2027-02-20"), on("2027-02-21")]).toEqual(["winter", "spring"]);
    expect([on("2027-05-20"), on("2027-05-21")]).toEqual(["spring", "summer"]);
    expect([on("2027-08-20"), on("2027-08-21")]).toEqual(["summer", "autumn"]);
    expect([on("2026-12-31"), on("2027-01-01")]).toEqual(["winter", "winter"]);
    // The day is UTC's: 23:30 on 20 November in UTC is still autumn wherever the server runs.
    expect(seasonFor(new Date("2026-11-20T23:30:00Z")).id).toBe("autumn");
    expect(seasonFor(new Date("2026-11-21T00:00:00Z")).id).toBe("winter");
  });

  test("a leap day is spring and the season names its tote and its bar", () => {
    expect(on("2028-02-29")).toBe("spring");
    const winter = seasonFor(new Date("2026-11-27T08:00:00Z"));
    expect(winter).toEqual(seasonById("winter"));
    expect(winter.giftTitle).toBe("Winter Tote Bag Edition");
    expect(winter.giftVariantId).toBe("velune-welcome-tote-winter");
    expect(winter.giftImage).toBe("/api/art/velune-welcome-tote-winter.svg");
    expect(winter.bannerTagline).toBe(
      "Winter Edition · Agentic Commerce Sandbox · 5% off & free Winter Tote on your first order",
    );
    expect(winter.bannerCompact).toBe("Winter Edition · Agentic Commerce Sandbox");
    expect(winter.bannerCompact).toContain("Agentic Commerce");
  });

  test("only the four gift ids are gift ids", () => {
    for (const id of ["winter", "spring", "summer", "autumn"] as const) {
      expect(isWelcomeGiftVariantId(`velune-welcome-tote-${id}`)).toBe(true);
      expect(seasonOfGift(`velune-welcome-tote-${id}`)).toBe(id);
    }
    for (const id of [
      "velune-welcome-tote-bogus",
      "velune-welcome-tote-winter.svg",
      "xvelune-welcome-tote-winter",
      "velune-welcome-tote-",
      "",
    ]) {
      expect(isWelcomeGiftVariantId(id)).toBe(false);
      expect(seasonOfGift(id)).toBeUndefined();
    }
  });
});

// The first-order welcome offer (ADR-020): 5 % off and a free seasonal tote, asked for, priced on
// the server, granted to an account with no order and checked again before paying.
// Spec: knowledge/components/agentic-storefront.md
import { beforeEach, describe, expect, test } from "bun:test";
import { handle } from "../api";
import { freshStore, ORIGIN } from "../testing/agent";

beforeEach(() => freshStore());

describe("welcome offer", () => {
  test("the tote's four pictures are served and any other gift name is 404", async () => {
    for (const season of ["winter", "spring", "summer", "autumn"]) {
      const response = await handle(
        new Request(`${ORIGIN}/api/art/velune-welcome-tote-${season}.svg`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
      const svg = await response.text();
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain(season.toUpperCase());
    }
    for (const name of ["velune-welcome-tote-bogus", "velune-welcome-tote-winter-x"]) {
      const response = await handle(new Request(`${ORIGIN}/api/art/${name}.svg`));
      expect(response.status).toBe(404);
    }
  });
});

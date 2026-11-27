// The OpenAI product feed: one row per variant, the spec's field names and formats, stable valid
// GTINs, and the two public endpoints.
// Spec: knowledge/components/agentic-storefront.md
import { beforeEach, describe, expect, test } from "bun:test";
import { handle } from "../api";
import { freshStore, ORIGIN } from "../testing/agent";
import { PRODUCTS, variantsOf } from "./catalog";
import { ean13, type FeedItem, openAiFeed } from "./openai-feed";

const validEan = (gtin: string) => /^\d{13}$/.test(gtin) && ean13(gtin.slice(0, 12)) === gtin;

describe("OpenAI product feed", () => {
  beforeEach(() => freshStore());

  test("ean13 adds the GS1 check digit", () => {
    expect(ean13("400638133393")).toBe("4006381333931");
    expect(ean13("978030640615")).toBe("9780306406157");
  });

  test("has one row per variant, each with a unique id and a valid in-store GTIN", () => {
    const items = openAiFeed(ORIGIN);
    expect(items.length).toBe(PRODUCTS.flatMap(variantsOf).length);
    expect(new Set(items.map((i) => i.item_id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.gtin)).size).toBe(items.length);
    for (const item of items) {
      expect(validEan(item.gtin)).toBe(true);
      expect(item.gtin.startsWith("200")).toBe(true);
    }
  });

  test("uses the spec's names and formats", () => {
    const items = openAiFeed(ORIGIN);
    const money = /^\d+\.\d{2} EUR$/;
    for (const item of items) {
      for (const key of [
        "item_id",
        "group_id",
        "title",
        "description",
        "url",
        "brand",
        "image_url",
        "availability",
        "price",
        "product_category",
        "seller_name",
        "seller_privacy_policy",
        "seller_tos",
        "return_policy",
      ])
        expect(typeof item[key]).toBe("string");
      expect(item.price).toMatch(money);
      expect(item.shipping_price).toMatch(money);
      expect(["in_stock", "out_of_stock"]).toContain(item.availability as string);
      expect(["male", "female", "unisex"]).toContain(item.gender as string);
      expect(item.star_rating).toMatch(/^\d\.\d{2}$/);
      expect(item.url).toStartWith(`${ORIGIN}/products/`);
      expect(item.image_url).toBe(`${ORIGIN}/api/art/${item.item_id}.svg`);
      expect(item).not.toHaveProperty("link");
      expect(item).not.toHaveProperty("item_group_id");
    }
  });

  test("a markdown sends the earlier price as price and the paid one as sale_price", () => {
    const marked = PRODUCTS.find((p) => p.compareAt !== undefined);
    if (!marked?.compareAt) throw new Error("the catalogue has no markdown");
    const row = openAiFeed(ORIGIN).find((i) => i.group_id === marked.id) as FeedItem;
    expect(row.price).toBe(`${(marked.compareAt / 100).toFixed(2)} EUR`);
    expect(row.sale_price).toBe(`${(marked.price / 100).toFixed(2)} EUR`);
    const plain = openAiFeed(ORIGIN).find((i) => i.group_id === "velune-trench") as FeedItem;
    expect(plain).not.toHaveProperty("sale_price");
  });

  test("shipping is free from 100 EUR, as at checkout", () => {
    const items = openAiFeed(ORIGIN);
    const byGroup = new Map(items.map((i) => [i.group_id, i]));
    for (const product of PRODUCTS) {
      const row = byGroup.get(product.id) as FeedItem;
      expect(row.shipping_price).toBe(product.price >= 10000 ? "0.00 EUR" : "4.95 EUR");
    }
  });

  test("GET /api/feeds/openai.json and .jsonl answer the same rows, public and cacheable", async () => {
    const asJson = await handle(new Request(`${ORIGIN}/api/feeds/openai.json`));
    expect(asJson.status).toBe(200);
    expect(asJson.headers.get("cache-control")).toBe("public, max-age=300");
    const { items } = (await asJson.json()) as { items: FeedItem[] };

    const asLines = await handle(new Request(`${ORIGIN}/api/feeds/openai.jsonl`));
    expect(asLines.status).toBe(200);
    expect(asLines.headers.get("content-type")).toStartWith("application/jsonl");
    const lines = (await asLines.text()).trim().split("\n");
    expect(lines.length).toBe(items.length);
    expect(JSON.parse(lines[0] as string)).toEqual(items[0] as FeedItem);
  });
});

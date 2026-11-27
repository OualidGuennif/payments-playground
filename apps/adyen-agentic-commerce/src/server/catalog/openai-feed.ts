// Spec: knowledge/components/agentic-storefront.md
// The catalogue as an OpenAI product feed: one row per variant, with the field names of the spec
// read on 2026-11-27 (developers.openai.com/commerce/specs/feed). Pure: the build and the origin.
import { FREE_SHIPPING_FROM, STANDARD_FEE } from "../../lib/delivery";
import { type Category, PRODUCTS, type Product, type Variant, variantsOf } from "./catalog";

export const BRAND = "Atelier Velune";
export const RETURN_DAYS = 30;

// Google's product taxonomy paths, the form the spec's examples use.
const TAXONOMY: Record<Category, string> = {
  clothing: "Apparel & Accessories > Clothing",
  footwear: "Apparel & Accessories > Shoes",
  bags: "Apparel & Accessories > Handbags, Wallets & Cases",
  accessories: "Apparel & Accessories > Clothing Accessories",
  essentials: "Apparel & Accessories",
};

export type FeedItem = Record<string, unknown> & { item_id: string; gtin: string };

const money = (minor: number) => `${(minor / 100).toFixed(2)} EUR`;

// EAN-13 check digit: weights 1 and 3 from the left over the first twelve digits.
export function ean13(twelve: string): string {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return `${twelve}${(10 - (sum % 10)) % 10}`;
}

// 200 to 299 is GS1's in-store range, never a real company's prefix. FNV-1a keeps a variant's
// number stable when products or colours are added elsewhere in the catalogue.
function gtinOf(variantId: string): string {
  let hash = 0x811c9dc5;
  for (const ch of variantId) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return ean13(`200${String(hash % 1_000_000_000).padStart(9, "0")}`);
}

function row(origin: string, product: Product, variant: Variant, siblings: number): FeedItem {
  const marked = product.compareAt !== undefined && product.compareAt > product.price;
  const oneSize = variant.size === "One size";
  return {
    item_id: variant.id,
    group_id: product.id,
    listing_has_variations: siblings > 1,
    variant_dict: oneSize
      ? { color: variant.colour.label }
      : { color: variant.colour.label, size: variant.size },
    title: variant.title,
    description: product.description,
    url: `${origin}/products/${product.id}?variant=${encodeURIComponent(variant.id)}`,
    brand: BRAND,
    seller_name: BRAND,
    seller_url: origin,
    image_url: `${origin}/api/art/${variant.id}.svg`,
    availability: variant.available ? "in_stock" : "out_of_stock",
    price: money(marked ? (product.compareAt as number) : product.price),
    ...(marked ? { sale_price: money(product.price) } : {}),
    gtin: gtinOf(variant.id),
    mpn: variant.id.toUpperCase(),
    condition: "new",
    product_category: TAXONOMY[product.category],
    color: variant.colour.label,
    size: variant.size,
    ...(oneSize ? {} : { size_system: "EU" }),
    gender: product.gender,
    age_group: "adult",
    material: product.material,
    ...(product.pattern ? { pattern: product.pattern } : {}),
    weight: product.weight,
    item_weight_unit: "g",
    dimensions: { ...product.dimensions, unit: "cm" },
    target_countries: ["FR"],
    store_country: "FR",
    shipping_price: money(product.price >= FREE_SHIPPING_FROM ? 0 : STANDARD_FEE),
    accepts_returns: true,
    return_deadline_in_days: RETURN_DAYS,
    return_policy: `${origin}/legal#returns`,
    review_count: product.reviews,
    star_rating: product.rating.toFixed(2),
    is_eligible_search: true,
    is_eligible_checkout: true,
    seller_privacy_policy: `${origin}/legal#privacy`,
    seller_tos: `${origin}/legal#terms`,
  };
}

export function openAiFeed(origin: string): FeedItem[] {
  return PRODUCTS.flatMap((product) => {
    const variants = variantsOf(product);
    return variants.map((v) => row(origin, product, v, variants.length));
  });
}

export const feedJsonl = (items: FeedItem[]) =>
  `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;

// Spec: knowledge/components/agentic-storefront.md
import { shopItemOf } from "@/components/cardOf";
import { ShopBrowser } from "@/components/shop/ShopBrowser";
import type { ShopItem, ShopQuery } from "@/components/shop/filter";
import { CATEGORIES, PRODUCTS } from "@/server/catalog/catalog";

export const metadata = { title: "Shop" };

const KEYS = [
  "category",
  "q",
  "collection",
  "gender",
  "price",
  "colour",
  "size",
  "sale",
  "sort",
] as const;

const ITEMS: ShopItem[] = PRODUCTS.map(shopItemOf);

export default async function Shop({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initial: ShopQuery = {};
  for (const key of KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length <= 120) initial[key] = value;
  }
  // Keyed by the address: a header link to another department starts from its own filters.
  return (
    <ShopBrowser
      key={JSON.stringify(initial)}
      items={ITEMS}
      categories={CATEGORIES}
      initial={initial}
    />
  );
}

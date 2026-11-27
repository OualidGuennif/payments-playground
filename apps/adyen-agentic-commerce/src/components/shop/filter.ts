// Spec: knowledge/components/agentic-storefront.md
// The shop's filters as a pure function, kept out of the client component so the server page and
// the tests can import it.
import type { CardProduct } from "@/components/ProductCard";

export type ShopItem = CardProduct & {
  category: string;
  gender: "male" | "female" | "unisex";
  sizes: string[];
  rating: number;
  haystack: string;
  order: number;
};

export type ShopQuery = Partial<
  Record<
    "category" | "q" | "collection" | "gender" | "price" | "colour" | "size" | "sale" | "sort",
    string
  >
>;

export const PRICES = [
  ["u50", "Under €50", 0, 5000],
  ["50-100", "€50 to €100", 5000, 10000],
  ["100-200", "€100 to €200", 10000, 20000],
  ["o200", "Over €200", 20000, Number.POSITIVE_INFINITY],
] as const;

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
export const list = (value: string | undefined) => (value ? value.split(",").filter(Boolean) : []);

export function filterItems(items: ShopItem[], query: ShopQuery): ShopItem[] {
  const terms = words(query.q ?? "");
  const price = PRICES.find(([id]) => id === query.price);
  const colours = list(query.colour);
  const sizes = list(query.size);
  const shown = items.filter((p) => {
    if (query.category && p.category !== query.category) return false;
    if (query.collection === "new" && p.badge !== "New") return false;
    if (query.sale === "1" && !p.compareAt) return false;
    if (query.gender === "women" && p.gender === "male") return false;
    if (query.gender === "men" && p.gender === "female") return false;
    if (price && (p.price < price[2] || p.price >= price[3])) return false;
    if (colours.length && !p.colours.some((c) => colours.includes(c.id))) return false;
    if (sizes.length && !p.sizes.some((s) => sizes.includes(s))) return false;
    return terms.every((w) => p.haystack.includes(w) || p.haystack.includes(w.replace(/s$/, "")));
  });
  const newFirst = (p: ShopItem) => (p.badge === "New" ? 0 : 1);
  const by: Record<string, (a: ShopItem, b: ShopItem) => number> = {
    new: (a, b) => newFirst(a) - newFirst(b) || a.order - b.order,
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating,
  };
  const sort = by[query.sort ?? ""];
  return sort ? [...shown].sort(sort) : shown;
}

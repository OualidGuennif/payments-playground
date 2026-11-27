// Spec: knowledge/components/agentic-storefront.md
// A product as its card shows it; server side, beside the catalogue.
import type { CardProduct } from "@/components/ProductCard";
import type { ShopItem } from "@/components/shop/filter";
import { type Product, variantsOf } from "@/server/catalog/catalog";

export const cardOf = (p: Product): CardProduct => ({
  id: p.id,
  title: p.title,
  subtitle: p.subtitle,
  price: p.price,
  compareAt: p.compareAt,
  badge: p.badge,
  colours: p.colours,
  firstVariant: variantsOf(p)[0]?.id ?? "",
});

// The searchable words match the server's search (catalog.ts searchProducts).
export const shopItemOf = (p: Product, order: number): ShopItem => ({
  ...cardOf(p),
  category: p.category,
  gender: p.gender,
  sizes: p.sizes,
  rating: p.rating,
  order,
  haystack: [
    p.title,
    p.description,
    p.category,
    p.subtitle,
    p.material,
    ...p.tags,
    ...p.colours.map((c) => c.label),
  ]
    .join(" ")
    .toLowerCase(),
});

// Spec: knowledge/components/adyen-agentic-commerce.md
// The catalogue of the fictional brand Atelier Velune: its shape, variants and search. The data is
// in products.ts. Prices are EUR minor units, VAT included.
import { PRODUCTS } from "./products";

export type Category = "clothing" | "footwear" | "bags" | "accessories" | "essentials";
// The order the storefront and every category filter show them in.
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "clothing", label: "Clothing" },
  { id: "footwear", label: "Footwear" },
  { id: "bags", label: "Bags" },
  { id: "accessories", label: "Accessories" },
  { id: "essentials", label: "Essentials" },
];
export type Shape =
  | "coat"
  | "sweater"
  | "shirt"
  | "trousers"
  | "tote"
  | "crossbody"
  | "weekender"
  | "scarf"
  | "beanie"
  | "belt"
  | "cardholder"
  | "sunglasses"
  | "socks"
  | "blazer"
  | "dress"
  | "parka"
  | "sneaker"
  | "boot"
  | "loafer"
  | "backpack"
  | "bucket"
  | "sling"
  | "tee"
  | "kit";

export type Colour = { id: string; label: string; hex: string };

export type Product = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: Category;
  shape: Shape;
  // What the shopper pays; `compareAt` is the price before a markdown, shown struck through.
  price: number;
  compareAt?: number;
  colours: Colour[];
  sizes: string[];
  soldOut?: string[];
  tags: string[];
  gender: "male" | "female" | "unisex";
  pattern?: string;
  material: string;
  care: string;
  fit: string;
  madeIn: string;
  highlights: string[];
  // Grams, and the packed parcel in centimetres: the product feed's weight and dimensions.
  weight: number;
  dimensions: { length: number; width: number; height: number };
  // Demo data: shown as such on the page and sent as such in the feed.
  rating: number;
  reviews: number;
  badge?: "New" | "Bestseller" | "Sale";
};

export type Variant = {
  id: string;
  productId: string;
  title: string;
  colour: Colour;
  size: string;
  price: number;
  available: boolean;
};

export { PRODUCTS };

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function variantsOf(product: Product): Variant[] {
  return product.colours.flatMap((colour) =>
    product.sizes.map((size) => {
      const id = `${product.id}-${colour.id}-${slug(size)}`;
      return {
        id,
        productId: product.id,
        title: `${product.title}, ${colour.label}, ${size}`,
        colour,
        size,
        price: product.price,
        available: !(product.soldOut ?? []).includes(id),
      };
    }),
  );
}

const VARIANTS = new Map(PRODUCTS.flatMap(variantsOf).map((v) => [v.id, v]));
const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export const productById = (id: string): Product | undefined => BY_ID.get(id);
export const variantById = (id: string): Variant | undefined => VARIANTS.get(id);

export function searchProducts(
  query = "",
  filters: { category?: string; maxPrice?: number } = {},
): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return PRODUCTS.filter((p) => {
    if (filters.category && p.category !== filters.category) return false;
    if (filters.maxPrice !== undefined && p.price > filters.maxPrice) return false;
    const haystack = [
      p.title,
      p.description,
      p.category,
      p.subtitle,
      p.material,
      ...p.tags,
      ...p.colours.map((x) => x.label),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w) || haystack.includes(w.replace(/s$/, "")));
  });
}

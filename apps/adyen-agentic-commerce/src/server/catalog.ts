// Spec: knowledge/components/adyen-agentic-commerce.md
// The catalogue of the fictional brand Atelier Velune. Prices are EUR minor units, VAT included.

export type Category = "clothing" | "bags" | "accessories";
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
  | "socks";

export type Colour = { id: string; label: string; hex: string };

export type Product = {
  id: string;
  title: string;
  description: string;
  category: Category;
  shape: Shape;
  price: number;
  colours: Colour[];
  sizes: string[];
  soldOut?: string[];
  tags: string[];
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

const c = (id: string, label: string, hex: string): Colour => ({ id, label, hex });
const SAND = c("sand", "Sand", "#c8b48f");
const OLIVE = c("olive", "Olive", "#6b6f3f");
const OAT = c("oat", "Oat", "#d9cdb4");
const NAVY = c("navy", "Navy", "#26324a");
const RUST = c("rust", "Rust", "#a4532f");
const WHITE = c("white", "White", "#f2f0ea");
const SKY = c("sky", "Sky", "#9cbad6");
const CHARCOAL = c("charcoal", "Charcoal", "#3a3a3c");
const CAMEL = c("camel", "Camel", "#b08350");
const NATURAL = c("natural", "Natural", "#e4d8bf");
const BLACK = c("black", "Black", "#1d1d1f");
const COGNAC = c("cognac", "Cognac", "#8a4b22");
const TERRACOTTA = c("terracotta", "Terracotta", "#c06a4a");
const INDIGO = c("indigo", "Indigo", "#3b3f8c");
const TORTOISE = c("tortoise", "Tortoise", "#6e4a2b");

const LETTER = ["S", "M", "L"];
const ONE = ["One size"];

export const PRODUCTS: Product[] = [
  {
    id: "velune-trench",
    title: "Linen-blend trench coat",
    description: "Double-breasted trench in a breathable linen and cotton blend, with a tie belt.",
    category: "clothing",
    shape: "coat",
    price: 18900,
    colours: [SAND, OLIVE],
    sizes: LETTER,
    tags: ["outerwear", "spring"],
  },
  {
    id: "velune-merino-crew",
    title: "Merino crew-neck sweater",
    description: "Fine-gauge extra-fine merino, ribbed hems, a regular fit that layers well.",
    category: "clothing",
    shape: "sweater",
    price: 8900,
    colours: [OAT, NAVY, RUST],
    sizes: [...LETTER, "XL"],
    tags: ["knitwear", "wool"],
  },
  {
    id: "velune-oxford-shirt",
    title: "Organic cotton oxford shirt",
    description: "Button-down collar, chest pocket, garment-washed for a soft hand.",
    category: "clothing",
    shape: "shirt",
    price: 5900,
    colours: [WHITE, SKY],
    sizes: LETTER,
    tags: ["shirt", "cotton"],
  },
  {
    id: "velune-wide-trousers",
    title: "Wide-leg wool trousers",
    description: "High-rise trousers in a soft wool twill with front pleats and side pockets.",
    category: "clothing",
    shape: "trousers",
    price: 11900,
    colours: [CHARCOAL, CAMEL],
    sizes: LETTER,
    tags: ["trousers", "wool"],
  },
  {
    id: "velune-rib-socks",
    title: "Cotton rib socks",
    description: "Mid-calf socks in combed cotton with a reinforced heel and toe.",
    category: "clothing",
    shape: "socks",
    price: 1200,
    colours: [OAT, NAVY, RUST],
    sizes: ONE,
    tags: ["socks", "cotton"],
  },
  {
    id: "velune-market-tote",
    title: "Canvas market tote",
    description: "Heavy cotton canvas, long handles and an inner zip pocket. Fits a laptop.",
    category: "bags",
    shape: "tote",
    price: 4500,
    colours: [NATURAL, BLACK],
    sizes: ONE,
    tags: ["tote", "canvas"],
  },
  {
    id: "velune-crossbody",
    title: "Leather crossbody bag",
    description: "Vegetable-tanned leather, adjustable strap, magnetic flap closure.",
    category: "bags",
    shape: "crossbody",
    price: 14900,
    colours: [COGNAC, BLACK],
    sizes: ONE,
    tags: ["leather", "crossbody"],
  },
  {
    id: "velune-weekender",
    title: "Waxed-canvas weekender",
    description: "A 40-litre holdall with leather handles and a detachable shoulder strap.",
    category: "bags",
    shape: "weekender",
    price: 21000,
    colours: [OLIVE, NAVY],
    sizes: ONE,
    soldOut: ["velune-weekender-navy-one-size"],
    tags: ["travel", "canvas"],
  },
  {
    id: "velune-silk-scarf",
    title: "Printed silk scarf",
    description: "A 90 cm square in silk twill with hand-rolled edges and an original print.",
    category: "accessories",
    shape: "scarf",
    price: 6500,
    colours: [TERRACOTTA, INDIGO],
    sizes: ONE,
    tags: ["silk", "scarf"],
  },
  {
    id: "velune-wool-beanie",
    title: "Ribbed wool beanie",
    description: "Chunky rib knit in recycled wool with a turned-up cuff.",
    category: "accessories",
    shape: "beanie",
    price: 2900,
    colours: [OAT, RUST, CHARCOAL],
    sizes: ONE,
    tags: ["wool", "hat"],
  },
  {
    id: "velune-leather-belt",
    title: "Leather belt",
    description: "A 3 cm belt in full-grain leather with a brushed brass buckle.",
    category: "accessories",
    shape: "belt",
    price: 4900,
    colours: [COGNAC, BLACK],
    sizes: ["85 cm", "90 cm", "95 cm"],
    tags: ["leather", "belt"],
  },
  {
    id: "velune-card-holder",
    title: "Leather card holder",
    description: "Four card slots and a central pocket, hand-stitched edges.",
    category: "accessories",
    shape: "cardholder",
    price: 3500,
    colours: [COGNAC, BLACK, OLIVE],
    sizes: ONE,
    tags: ["leather", "small goods"],
  },
  {
    id: "velune-sunglasses",
    title: "Acetate sunglasses",
    description: "Rounded acetate frames with UV400 lenses and a cotton case.",
    category: "accessories",
    shape: "sunglasses",
    price: 9500,
    colours: [TORTOISE, BLACK],
    sizes: ONE,
    tags: ["eyewear", "summer"],
  },
];

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
    })
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
    const haystack = [p.title, p.description, p.category, ...p.tags, ...p.colours.map((x) => x.label)]
      .join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w) || haystack.includes(w.replace(/s$/, "")));
  });
}

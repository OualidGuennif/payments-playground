// Spec: knowledge/components/agentic-storefront.md
import Link from "next/link";
import { notFound } from "next/navigation";
import { cardOf } from "@/components/cardOf";
import { GsapReveal } from "@/components/motion/GsapReveal";
import { GsapStaggerGrid } from "@/components/motion/GsapStaggerGrid";
import { ProductCard } from "@/components/ProductCard";
import { VariantPicker } from "@/components/VariantPicker";
import { EXPRESS_FEE, FREE_SHIPPING_FROM, STANDARD_FEE } from "@/lib/delivery";
import { money } from "@/lib/money";
import {
  CATEGORIES,
  PRODUCTS,
  type Product,
  productById,
  variantsOf,
} from "@/server/catalog/catalog";
import { productFeed, RETURN_DAYS } from "@/server/catalog/openai-feed";
import { config } from "@/server/core/config";

// PUBLIC_ORIGIN is read per request: the feed rows name it.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const product = productById((await params).id);
  return product ? { title: product.title, description: product.subtitle } : {};
}

// The best-rated piece of each other department that suits the same shopper: four at most.
function completeTheLook(product: Product): Product[] {
  const suits = (p: Product) =>
    product.gender === "unisex" || p.gender === "unisex" || p.gender === product.gender;
  return CATEGORIES.filter((c) => c.id !== product.category)
    .flatMap((c) => {
      const best = PRODUCTS.filter((p) => p.category === c.id && suits(p)).sort(
        (a, b) => b.rating - a.rating,
      )[0];
      return best ? [best] : [];
    })
    .slice(0, 4);
}

function Fold({
  title,
  children,
  open,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-b border-line">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between text-base font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span
          aria-hidden="true"
          className="text-xl leading-none text-muted transition group-open:rotate-45 motion-reduce:transition-none"
        >
          +
        </span>
      </summary>
      <div className="space-y-2 pb-5 text-sm text-muted">{children}</div>
    </details>
  );
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const product = productById((await params).id);
  if (!product) notFound();
  const variants = variantsOf(product).map((v) => ({
    id: v.id,
    colour: v.colour.label,
    colourId: v.colour.id,
    hex: v.colour.hex,
    size: v.size,
    available: v.available,
  }));
  const { variant } = await searchParams;
  const feed = Object.fromEntries(
    productFeed(config().publicOrigin, product).map((row) => [row.item_id, row]),
  );
  const department = CATEGORIES.find((c) => c.id === product.category);
  const look = completeTheLook(product);
  return (
    <div className="space-y-16">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/shop" className="underline">
          Shop
        </Link>{" "}
        /{" "}
        <Link href={`/shop?category=${product.category}`} className="underline">
          {department?.label ?? product.category}
        </Link>
      </nav>
      <div className="-mt-10">
        <VariantPicker
          product={{
            id: product.id,
            title: product.title,
            subtitle: product.subtitle,
            description: product.description,
            price: product.price,
            compareAt: product.compareAt,
            badge: product.badge,
            rating: product.rating,
            reviews: product.reviews,
          }}
          variants={variants}
          initial={variants.some((v) => v.id === variant) ? variant : undefined}
          feed={feed}
        >
          <Fold title="Details" open>
            <ul className="list-disc space-y-1 pl-5">
              {product.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <p>Made in {product.madeIn}.</p>
          </Fold>
          <Fold title="Material and care">
            <p>{product.material}</p>
            <p>{product.care}</p>
          </Fold>
          <Fold title="Fit">
            <p>{product.fit}</p>
          </Fold>
          <Fold title="Delivery and returns">
            <p>
              Standard delivery {money(STANDARD_FEE)}, free from {money(FREE_SHIPPING_FROM)}.
              Express {money(EXPRESS_FEE)}, or a pickup point. Returns within {RETURN_DAYS} days.
            </p>
            <p>This is a TEST store: nothing ships and no money moves.</p>
          </Fold>
        </VariantPicker>
      </div>
      {look.length ? (
        <GsapReveal as="section" className="space-y-6">
          <h2 className="text-3xl">Complete the look</h2>
          <GsapStaggerGrid className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {look.map((p) => (
              <ProductCard key={p.id} product={cardOf(p)} />
            ))}
          </GsapStaggerGrid>
        </GsapReveal>
      ) : null}
    </div>
  );
}

// Spec: knowledge/components/agentic-storefront.md
import Link from "next/link";
import { GsapCard } from "@/components/motion/GsapCard";
import { money } from "@/lib/money";
import type { Product } from "@/server/catalog/catalog";

// What a card needs, small enough to hand to the shop's client-side filter (built in cardOf.ts,
// so the browser never loads the catalogue's code).
export type CardProduct = Pick<
  Product,
  "id" | "title" | "subtitle" | "price" | "compareAt" | "badge" | "colours"
> & { firstVariant: string };

export function ProductCard({
  product,
  heading = "h3",
}: {
  product: CardProduct;
  heading?: "h2" | "h3";
}) {
  const Heading = heading;
  return (
    <GsapCard>
      <Link href={`/products/${product.id}`} className="group block">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-[#f4f1ec]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
          <img
            data-card="art"
            src={`/api/art/${product.firstVariant}.svg`}
            alt={product.title}
            width={480}
            height={480}
            loading="lazy"
            className="aspect-[4/5] w-full object-cover"
          />
          {product.badge ? (
            <span
              className={`absolute top-3 left-3 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                product.badge === "Sale" ? "bg-bad text-paper" : "bg-ink text-paper"
              }`}
            >
              {product.badge}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <Heading className="font-serif text-base leading-snug">{product.title}</Heading>
          <span className="shrink-0 text-sm tabular-nums">
            {product.compareAt ? (
              <>
                <span className="sr-only">Now </span>
                <span className="text-bad">{money(product.price)}</span>{" "}
                <s className="text-muted">
                  <span className="sr-only">was </span>
                  {money(product.compareAt)}
                </s>
              </>
            ) : (
              money(product.price)
            )}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{product.subtitle}</p>
        <ul className="mt-2 flex gap-1.5" aria-label={`${product.colours.length} colours`}>
          {product.colours.map((c) => (
            <li key={c.id}>
              <svg
                viewBox="0 0 10 10"
                className="size-3.5 rounded-full border border-line"
                role="img"
                aria-label={c.label}
              >
                <circle cx="5" cy="5" r="5" fill={c.hex} />
              </svg>
            </li>
          ))}
        </ul>
      </Link>
    </GsapCard>
  );
}

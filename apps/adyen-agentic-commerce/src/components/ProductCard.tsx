// Spec: knowledge/components/agentic-storefront.md
"use client";
import Link from "next/link";
import { useState } from "react";
import { GsapCard } from "@/components/motion/GsapCard";
import { money } from "@/lib/money";
import type { Product } from "@/server/catalog/catalog";

// What a card needs, small enough to hand to the shop's client-side filter (built in cardOf.ts,
// so the browser never loads the catalogue's code).
export type CardProduct = Pick<
  Product,
  "id" | "title" | "subtitle" | "price" | "compareAt" | "badge" | "colours"
> & {
  firstVariant: string;
  // Each colour's first variant, so a swatch shows that colour's picture and opens it.
  colourVariants: Record<string, string>;
};

export function ProductCard({
  product,
  heading = "h3",
}: {
  product: CardProduct;
  heading?: "h2" | "h3";
}) {
  const Heading = heading;
  const [colour, setColour] = useState(product.colours[0]?.id);
  const variant = (colour && product.colourVariants[colour]) || product.firstVariant;
  const href =
    variant === product.firstVariant
      ? `/products/${product.id}`
      : `/products/${product.id}?variant=${encodeURIComponent(variant)}`;
  const count = product.colours.length;
  return (
    <GsapCard>
      <Link href={href} className="group block">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-[#f4f1ec]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
          <img
            data-card="art"
            src={`/api/art/${variant}.svg`}
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
      </Link>
      {/* Outside the link: a swatch is its own control. Tapping or hovering one shows that colour
          and points the card's link at it. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
        {count > 1 ? (
          <ul className="flex flex-wrap gap-1" aria-label={`${product.title}: colours`}>
            {product.colours.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={c.id === colour}
                  aria-label={`Show ${c.label}`}
                  title={c.label}
                  className="relative grid size-9 cursor-pointer place-items-center rounded-full after:absolute after:-inset-0.5 hover:bg-line/60 aria-pressed:ring-1 aria-pressed:ring-ink"
                  onClick={() => setColour(c.id)}
                  onMouseEnter={() => setColour(c.id)}
                  onFocus={() => setColour(c.id)}
                >
                  <svg
                    viewBox="0 0 10 10"
                    className="size-4 rounded-full border border-line"
                    aria-hidden="true"
                  >
                    <circle cx="5" cy="5" r="5" fill={c.hex} />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <svg
            viewBox="0 0 10 10"
            className="size-4 rounded-full border border-line"
            role="img"
            aria-label={product.colours[0]?.label ?? "One colour"}
          >
            <circle cx="5" cy="5" r="5" fill={product.colours[0]?.hex ?? "currentColor"} />
          </svg>
        )}
        <span className="pl-1 text-xs text-muted">
          {count === 1 ? "1 colour" : `${count} colours`}
        </span>
      </div>
    </GsapCard>
  );
}

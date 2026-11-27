// Spec: knowledge/components/agentic-storefront.md
"use client";
import Link from "next/link";
import { type ReactNode, useId, useMemo, useState } from "react";
import { AskButton } from "@/components/ask/AskButton";
import { useCart } from "@/lib/client";
import { money } from "@/lib/money";

type V = {
  id: string;
  colour: string;
  colourId: string;
  hex: string;
  size: string;
  available: boolean;
};
type P = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  price: number;
  compareAt?: number;
  badge?: string;
  rating: number;
  reviews: number;
};

function Stars({ rating }: { rating: number }) {
  const filled = Math.round(rating * 2) / 2;
  const uid = useId();
  return (
    <span className="inline-flex text-accent" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className="size-4" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}-${i}`}>
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path
            d="M10 1.8 12.5 7l5.7.6-4.3 3.9 1.2 5.6L10 14.2 4.9 17.1l1.2-5.6L1.8 7.6 7.5 7Z"
            fill={
              i <= filled
                ? "currentColor"
                : i - 0.5 === filled
                  ? `url(#${uid}-${i})`
                  : "transparent"
            }
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      ))}
    </span>
  );
}

export function VariantPicker({
  product,
  variants,
  initial,
  feed,
  children,
}: {
  product: P;
  variants: V[];
  initial?: string;
  // The variant's OpenAI feed row, by variant id: what the developer tab shows.
  feed: Record<string, unknown>;
  // The page's folds (details, care, fit, delivery), under the buttons.
  children?: ReactNode;
}) {
  const start =
    variants.find((v) => v.id === initial) ?? variants.find((v) => v.available) ?? variants[0]!;
  const [colour, setColour] = useState(start.colourId);
  const [size, setSize] = useState(start.size);
  const [added, setAdded] = useState(false);
  const { add } = useCart();
  const colours = useMemo(
    () => [...new Map(variants.map((v) => [v.colourId, v])).values()],
    [variants],
  );
  const sizes = useMemo(() => [...new Set(variants.map((v) => v.size))], [variants]);
  const chosen = variants.find((v) => v.colourId === colour && v.size === size) ?? start;
  const oneSize = sizes.length === 1 && sizes[0] === "One size";

  return (
    // Both columns may shrink (min-w-0, minmax(0, …)): an open fold never widens the page.
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
      <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-[2rem] border border-line bg-[#f4f1ec]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
          <img
            src={`/api/art/${chosen.id}.svg`}
            alt={`${product.title} in ${chosen.colour}`}
            width={720}
            height={720}
            className="aspect-square w-full"
          />
        </div>
        {colours.length > 1 ? (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {colours.map((c) => (
              <button
                key={c.colourId}
                type="button"
                onClick={() => {
                  setColour(c.colourId);
                  setAdded(false);
                }}
                aria-label={`Show ${c.colour}`}
                aria-pressed={colour === c.colourId}
                className={`overflow-hidden rounded-xl border-2 bg-[#f4f1ec] ${colour === c.colourId ? "border-ink" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
                <img
                  src={`/api/art/${c.id}.svg`}
                  alt=""
                  width={120}
                  height={120}
                  loading="lazy"
                  className="aspect-square w-full"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 space-y-7">
        <div className="space-y-3">
          {product.badge ? <p className="eyebrow text-accent">{product.badge}</p> : null}
          <h1 className="text-4xl leading-tight">{product.title}</h1>
          <p className="text-muted">{product.subtitle}</p>
          <p className="flex items-center gap-2 text-sm">
            <Stars rating={product.rating} />
            <span>
              {product.rating.toFixed(1)} · {product.reviews} reviews{" "}
              <span className="text-muted">(demo data)</span>
            </span>
          </p>
          <p className="text-2xl tabular-nums">
            {product.compareAt ? (
              <>
                <span className="text-bad">{money(product.price)}</span>{" "}
                <s className="text-lg text-muted">
                  <span className="sr-only">was </span>
                  {money(product.compareAt)}
                </s>
              </>
            ) : (
              money(product.price)
            )}
          </p>
          <p className="text-muted">{product.description}</p>
        </div>
        <fieldset className="space-y-2.5">
          <legend className="eyebrow">Colour: {chosen.colour}</legend>
          <div className="flex flex-wrap gap-2">
            {colours.map((c) => (
              <button
                key={c.colourId}
                type="button"
                onClick={() => {
                  setColour(c.colourId);
                  setAdded(false);
                }}
                aria-pressed={colour === c.colourId}
                aria-label={c.colour}
                className={`size-11 cursor-pointer rounded-full border-2 p-0.5 ${colour === c.colourId ? "border-ink" : "border-line"}`}
              >
                <svg viewBox="0 0 10 10" className="size-full rounded-full" aria-hidden="true">
                  <circle cx="5" cy="5" r="5" fill={c.hex} />
                </svg>
              </button>
            ))}
          </div>
        </fieldset>
        {oneSize ? null : (
          <fieldset className="space-y-2.5">
            <legend className="eyebrow">Size: {size}</legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {sizes.map((s) => {
                const v = variants.find((x) => x.colourId === colour && x.size === s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!v?.available}
                    onClick={() => {
                      setSize(s);
                      setAdded(false);
                    }}
                    aria-pressed={size === s}
                    className="chip min-h-11 justify-center"
                  >
                    {s}
                    {v?.available ? null : <span className="sr-only"> (sold out)</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <div className="space-y-3">
          <button
            type="button"
            className="btn w-full"
            disabled={!chosen.available}
            onClick={() => {
              add(chosen.id);
              setAdded(true);
            }}
          >
            {chosen.available ? `Add to bag · ${money(product.price)}` : "Sold out"}
          </button>
          <p className="min-h-5 text-center text-sm" role="status">
            {added ? (
              <>
                Added to your bag.{" "}
                <Link href="/cart" className="underline">
                  View bag
                </Link>
              </>
            ) : null}
          </p>
          <AskButton
            question={`Tell me about the ${product.title} in ${chosen.colour}${oneSize ? "" : `, size ${size}`}: fit, care and what to wear it with.`}
            className="btn-ghost w-full"
          >
            Ask your Personal Shopper about this piece
          </AskButton>
        </div>
        <div>{children}</div>
        <details className="group rounded-2xl border border-line bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            OpenAI feed &amp; UCP data
            <span className="text-xs text-muted group-open:hidden">For developers</span>
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
            <p className="break-words">
              UCP item id <span className="code">{chosen.id}</span>: an agent buys this colour and
              size by sending it as <span className="code">line_items[].item.id</span>.
            </p>
            <p className="text-muted">
              This variant&apos;s row in the{" "}
              <a href="/api/feeds/openai.json" className="underline">
                OpenAI product feed
              </a>
              :
            </p>
            <pre className="max-h-80 max-w-full overflow-auto rounded-xl bg-paper p-3 font-mono text-xs leading-relaxed">
              {JSON.stringify(feed[chosen.id] ?? {}, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

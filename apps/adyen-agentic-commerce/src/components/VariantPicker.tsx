// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
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
type P = { id: string; title: string; description: string; price: number; tags: string[] };

export function VariantPicker({
  product,
  variants,
  initial,
}: {
  product: P;
  variants: V[];
  initial?: string;
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

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="overflow-hidden rounded-3xl border border-line bg-[#f4f1ec]">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
        <img
          src={`/api/art/${chosen.id}.svg`}
          alt={`${product.title} in ${chosen.colour}`}
          width={480}
          height={480}
          className="aspect-square w-full"
        />
      </div>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl leading-tight">{product.title}</h1>
          <p className="text-xl tabular-nums">{money(product.price)}</p>
          <p className="text-muted">{product.description}</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="eyebrow">Colour: {chosen.colour}</legend>
          <div className="flex gap-2">
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
                className={`size-11 cursor-pointer rounded-full border-2 ${colour === c.colourId ? "border-ink" : "border-line"}`}
              >
                <svg viewBox="0 0 10 10" className="size-full rounded-full" aria-hidden="true">
                  <circle cx="5" cy="5" r="5" fill={c.hex} />
                </svg>
              </button>
            ))}
          </div>
        </fieldset>
        {sizes.length > 1 || sizes[0] !== "One size" ? (
          <fieldset className="space-y-2">
            <legend className="eyebrow">Size</legend>
            <div className="flex flex-wrap gap-2">
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
                    className={size === s ? "btn px-4 py-1.5" : "btn-ghost px-4 py-1.5"}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn"
            disabled={!chosen.available}
            onClick={() => {
              add(chosen.id);
              setAdded(true);
            }}
          >
            {chosen.available ? "Add to cart" : "Sold out"}
          </button>
          {added ? (
            <Link href="/cart" className="text-sm underline">
              Added. View cart
            </Link>
          ) : null}
        </div>
        <div className="panel space-y-1 text-sm">
          <p className="eyebrow">For agents</p>
          <p>
            Variant id <span className="code">{chosen.id}</span>
          </p>
          <p className="text-muted">
            Pass it as <span className="code">line_items[].item.id</span> in a UCP checkout.
          </p>
        </div>
      </div>
    </div>
  );
}

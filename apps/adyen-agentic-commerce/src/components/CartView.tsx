// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FreeShippingGauge } from "@/components/FreeShippingGauge";
import { api, useCart } from "@/lib/client";
import { deliveryFee } from "@/lib/delivery";
import { money } from "@/lib/money";

type Info = Record<string, { title: string; price: number; available: boolean }>;

const MAX_QUANTITY = 10;

// The bag before checkout. It asks for no email: the checkout page takes the account's when the
// shopper is signed in, and asks a guest there, next to Pay.
export function CartView({ variants }: { variants: Info }) {
  const { lines, setQuantity, clear } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const known = lines.filter((l) => variants[l.variantId]);
  const subtotal = known.reduce(
    (sum, l) => sum + (variants[l.variantId]?.price ?? 0) * l.quantity,
    0,
  );
  const pieces = known.reduce((sum, l) => sum + l.quantity, 0);
  const shipping = deliveryFee("standard", subtotal);

  async function checkout() {
    setBusy(true);
    setError(undefined);
    const { data, error } = await api().checkouts.post({ lines: known });
    if (error || !data || !("id" in data)) {
      setBusy(false);
      setError("The checkout could not be created. Check the bag and try again.");
      return;
    }
    clear();
    router.push(`/checkout/${data.id}`);
  }

  if (!known.length) {
    return (
      <div className="panel mx-auto max-w-lg space-y-4 text-center">
        <h1 className="text-3xl">Your bag is empty</h1>
        <p className="text-sm text-muted">
          Browse the collection, or ask your Personal Shopper for an idea.
        </p>
        <Link href="/shop" className="btn">
          Browse the collection
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-4xl">Bag</h1>
          <p className="text-sm text-muted">
            {pieces} piece{pieces === 1 ? "" : "s"}
          </p>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {known.map((l) => {
            const v = variants[l.variantId];
            if (!v) return null;
            const [name, ...rest] = v.title.split(", ");
            return (
              <li key={l.variantId} className="flex gap-4 py-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
                <img
                  src={`/api/art/${l.variantId}.svg`}
                  alt=""
                  width={96}
                  height={120}
                  className="aspect-[4/5] w-24 shrink-0 rounded-xl border border-line bg-card object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{name}</p>
                      <p className="text-sm text-muted">{rest.join(" · ")}</p>
                    </div>
                    <p className="tabular-nums">{money(v.price * l.quantity)}</p>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3">
                    <div className="inline-flex items-center rounded-full border border-line">
                      <button
                        type="button"
                        className="size-10 cursor-pointer rounded-full text-lg"
                        aria-label={`One fewer ${name}`}
                        onClick={() => setQuantity(l.variantId, l.quantity - 1)}
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
                        <span className="sr-only">Quantity </span>
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        className="size-10 cursor-pointer rounded-full text-lg disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`One more ${name}`}
                        disabled={l.quantity >= MAX_QUANTITY}
                        onClick={() => setQuantity(l.variantId, l.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="min-h-10 cursor-pointer text-sm text-muted underline hover:text-ink"
                      onClick={() => setQuantity(l.variantId, 0)}
                    >
                      Remove<span className="sr-only"> {name}</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <Link href="/shop" className="inline-block text-sm underline">
          Continue shopping
        </Link>
      </section>
      <aside className="panel space-y-5 lg:sticky lg:top-24" aria-label="Order summary">
        <FreeShippingGauge subtotal={subtotal} />
        <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Standard delivery</dt>
            <dd className="tabular-nums">{shipping ? money(shipping) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-medium">
            <dt>Estimated total</dt>
            <dd className="tabular-nums">{money(subtotal + shipping)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          Contact, delivery (express or a pickup point too) and payment come on the next page.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn w-full" disabled={busy} onClick={checkout}>
          {busy ? "Opening checkout…" : "Checkout"}
        </button>
      </aside>
    </div>
  );
}

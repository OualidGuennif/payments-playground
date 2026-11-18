// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, DEMO_EMAIL, useCart } from "@/lib/client";
import { money } from "@/lib/money";

type Info = Record<string, { title: string; price: number; available: boolean }>;

export function CartView({ variants }: { variants: Info }) {
  const { lines, setQuantity, clear } = useCart();
  const router = useRouter();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const known = lines.filter((l) => variants[l.variantId]);
  const subtotal = known.reduce((sum, l) => sum + variants[l.variantId]!.price * l.quantity, 0);

  async function checkout() {
    setBusy(true);
    setError(undefined);
    const { data, error } = await api().checkouts.post({ lines: known, email });
    setBusy(false);
    if (error || !data || !("id" in data)) {
      setError("The checkout could not be created. Check the cart and try again.");
      return;
    }
    clear();
    router.push(`/checkout/${data.id}`);
  }

  if (!known.length) {
    return (
      <div className="panel mx-auto max-w-lg space-y-3 text-center">
        <h1 className="text-2xl">Your cart is empty</h1>
        <Link href="/shop" className="btn">
          Browse the collection
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-8 md:grid-cols-[1.5fr_1fr]">
      <section className="space-y-4">
        <h1 className="text-3xl">Cart</h1>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
          {known.map((l) => {
            const v = variants[l.variantId]!;
            return (
              <li key={l.variantId} className="flex items-center gap-4 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
                <img
                  src={`/api/art/${l.variantId}.svg`}
                  alt=""
                  width={64}
                  height={64}
                  className="size-16 rounded-xl border border-line"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.title}</p>
                  <p className="text-xs text-muted tabular-nums">{money(v.price)}</p>
                </div>
                <label className="sr-only" htmlFor={`q-${l.variantId}`}>
                  Quantity
                </label>
                <select
                  id={`q-${l.variantId}`}
                  value={l.quantity}
                  onChange={(e) => setQuantity(l.variantId, Number(e.target.value))}
                  className="field w-20"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "Remove" : n}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </section>
      <aside className="panel h-fit space-y-4">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span className="tabular-nums">{money(subtotal)}</span>
        </div>
        <p className="text-xs text-muted">
          Shipping is free from €100, otherwise €4.95. The total is confirmed at checkout.
        </p>
        <div className="space-y-1">
          <label htmlFor="email" className="eyebrow">
            Email for the receipt
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn w-full" disabled={busy} onClick={checkout}>
          {busy ? "Creating checkout…" : "Checkout"}
        </button>
      </aside>
    </div>
  );
}

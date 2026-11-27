// Spec: knowledge/components/agentic-storefront.md
// How far the bag is from free standard delivery, from the same threshold the server prices with.
import { FREE_SHIPPING_FROM } from "@/lib/delivery";
import { money } from "@/lib/money";

export function FreeShippingGauge({ subtotal }: { subtotal: number }) {
  const left = FREE_SHIPPING_FROM - subtotal;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {left > 0 ? (
          <>
            <span className="font-medium tabular-nums">{money(left)}</span> away from free standard
            delivery
          </>
        ) : (
          <span className="font-medium">Standard delivery is free</span>
        )}
      </p>
      <progress
        className="gauge"
        max={FREE_SHIPPING_FROM}
        value={Math.min(subtotal, FREE_SHIPPING_FROM)}
        aria-label={`Free standard delivery from ${money(FREE_SHIPPING_FROM)}`}
      />
    </div>
  );
}

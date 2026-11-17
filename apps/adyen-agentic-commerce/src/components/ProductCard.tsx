// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { type Product, variantsOf } from "@/server/catalog";
import { money } from "@/lib/money";

export function ProductCard({
  product,
  heading = "h3",
}: {
  product: Product;
  heading?: "h2" | "h3";
}) {
  const first = variantsOf(product)[0]!;
  const Heading = heading;
  return (
    <Link href={`/products/${product.id}`} className="group block">
      <div className="overflow-hidden rounded-2xl border border-line bg-[#f4f1ec]">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
        <img
          src={`/api/art/${first.id}.svg`}
          alt={product.title}
          width={480}
          height={480}
          className="aspect-square w-full transition duration-300 group-hover:scale-[1.03]"
        />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <Heading className="font-serif text-base leading-snug">{product.title}</Heading>
        <span className="text-sm tabular-nums">{money(product.price)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{product.colours.map((c) => c.label).join(" · ")}</p>
    </Link>
  );
}

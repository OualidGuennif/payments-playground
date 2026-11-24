// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { searchProducts } from "@/server/catalog/catalog";

export const metadata = { title: "Shop" };

const CATEGORIES = [
  ["", "All"],
  ["clothing", "Clothing"],
  ["bags", "Bags"],
  ["accessories", "Accessories"],
] as const;

export default async function Shop({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const { category = "", q = "" } = await searchParams;
  const products = searchProducts(q, { category: category || undefined });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">The collection</h1>
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map(([id, label]) => (
          <Link
            key={id}
            href={id ? `/shop?category=${id}` : "/shop"}
            aria-current={category === id ? "page" : undefined}
            className={category === id ? "btn px-4 py-1.5" : "btn-ghost px-4 py-1.5"}
          >
            {label}
          </Link>
        ))}
        <form className="ml-auto w-full sm:w-64" action="/shop">
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <label className="sr-only" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search: wool, leather…"
            className="field"
          />
        </form>
      </div>
      {products.length ? (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} heading="h2" />
          ))}
        </div>
      ) : (
        <p className="text-muted">Nothing matches. Try another word.</p>
      )}
    </div>
  );
}

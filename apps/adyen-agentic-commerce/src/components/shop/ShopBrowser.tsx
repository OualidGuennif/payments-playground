"use client";
// Spec: knowledge/components/agentic-storefront.md
// The shop's filters, applied in the browser as the shopper types or taps, with the address kept
// in step (category, q, collection, gender, price, colour, size, sale, sort) so a link or the
// Personal Shopper's /shop?category=…&q=… opens the same view.
import { useEffect, useMemo, useState } from "react";
import { GsapStaggerGrid } from "@/components/motion/GsapStaggerGrid";
import { useSheetMotion } from "@/components/motion/GsapSheet";
import { ProductCard } from "@/components/ProductCard";
import { filterItems, list, PRICES, type ShopItem, type ShopQuery } from "./filter";

const GENDERS = [
  ["", "Everyone"],
  ["women", "Women"],
  ["men", "Men"],
] as const;
const SORTS = [
  ["", "Featured"],
  ["new", "New in"],
  ["price-asc", "Price, low to high"],
  ["price-desc", "Price, high to low"],
  ["rating", "Top rated"],
] as const;
const SIZE_ORDER = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
  "85 cm",
  "90 cm",
  "95 cm",
  "One size",
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2.5 border-t border-line pt-4">
      <legend className="eyebrow float-left mb-2.5 w-full">{title}</legend>
      <div className="clear-both flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

export function ShopBrowser({
  items,
  categories,
  initial,
}: {
  items: ShopItem[];
  categories: { id: string; label: string }[];
  initial: ShopQuery;
}) {
  const [query, setQuery] = useState<ShopQuery>(initial);
  const [drawer, setDrawer] = useState(false);
  const sheet = useSheetMotion<HTMLDivElement>(drawer);
  const shown = useMemo(() => filterItems(items, query), [items, query]);
  const colours = useMemo(
    () => [...new Map(items.flatMap((p) => p.colours).map((c) => [c.id, c])).values()],
    [items],
  );
  const sizes = useMemo(() => {
    const present = new Set(items.flatMap((p) => p.sizes));
    return SIZE_ORDER.filter((s) => present.has(s));
  }, [items]);

  // The address follows the filters without a server round trip.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    const next = params.size ? `/shop?${params}` : "/shop";
    if (next !== `${location.pathname}${location.search}`) history.replaceState(null, "", next);
  }, [query]);

  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [drawer]);

  const set = (key: keyof ShopQuery, value: string | undefined) =>
    setQuery((q) => ({ ...q, [key]: value || undefined }));
  const toggle = (key: "colour" | "size", value: string) =>
    setQuery((q) => {
      const now = list(q[key]);
      const next = now.includes(value) ? now.filter((x) => x !== value) : [...now, value];
      return { ...q, [key]: next.join(",") || undefined };
    });
  const active = Object.entries(query).filter(([k, v]) => v && k !== "sort" && k !== "q").length;

  const filters = (
    <div className="space-y-4">
      <Group title="Department">
        <button
          type="button"
          className="chip"
          aria-pressed={!query.category && query.collection !== "new"}
          onClick={() => setQuery((q) => ({ ...q, category: undefined, collection: undefined }))}
        >
          All
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={query.collection === "new"}
          onClick={() => set("collection", query.collection === "new" ? undefined : "new")}
        >
          New in
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            aria-pressed={query.category === c.id}
            onClick={() => set("category", query.category === c.id ? undefined : c.id)}
          >
            {c.label}
          </button>
        ))}
      </Group>
      <Group title="For">
        {GENDERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={(query.gender ?? "") === id}
            onClick={() => set("gender", id)}
          >
            {label}
          </button>
        ))}
      </Group>
      <Group title="Price">
        {PRICES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={query.price === id}
            onClick={() => set("price", query.price === id ? undefined : id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={query.sale === "1"}
          onClick={() => set("sale", query.sale === "1" ? undefined : "1")}
        >
          On sale
        </button>
      </Group>
      <Group title="Colour">
        {colours.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip pl-1.5"
            aria-pressed={list(query.colour).includes(c.id)}
            onClick={() => toggle("colour", c.id)}
          >
            <svg
              viewBox="0 0 10 10"
              className="size-5 rounded-full border border-line"
              aria-hidden="true"
            >
              <circle cx="5" cy="5" r="5" fill={c.hex} />
            </svg>
            {c.label}
          </button>
        ))}
      </Group>
      <Group title="Size">
        {sizes.map((s) => (
          <button
            key={s}
            type="button"
            className="chip min-w-11 justify-center"
            aria-pressed={list(query.size).includes(s)}
            onClick={() => toggle("size", s)}
          >
            {s}
          </button>
        ))}
      </Group>
      {active ? (
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setQuery((q) => ({ q: q.q, sort: q.sort }))}
        >
          Clear {active} filter{active === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  );

  const title =
    query.collection === "new"
      ? "New in"
      : (categories.find((c) => c.id === query.category)?.label ?? "The collection");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">{title}</h1>
          <p className="mt-1 text-sm text-muted" role="status">
            {shown.length} piece{shown.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <span className="sr-only">Search the collection</span>
            <input
              type="search"
              value={query.q ?? ""}
              onChange={(event) => set("q", event.target.value)}
              placeholder="Search: wool, leather, boots…"
              className="field min-h-11"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only sm:not-sr-only">Sort</span>
            <select
              value={query.sort ?? ""}
              onChange={(event) => set("sort", event.target.value)}
              className="field min-h-11 w-auto"
            >
              {SORTS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-ghost lg:hidden"
            aria-expanded={drawer}
            aria-controls="shop-filters"
            onClick={() => setDrawer(true)}
          >
            Filters{active ? ` (${active})` : ""}
          </button>
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-24">{filters}</div>
        </aside>
        {drawer ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close the filters"
              className="absolute inset-0 bg-ink/40"
              onClick={() => setDrawer(false)}
            />
            <div
              ref={sheet}
              id="shop-filters"
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-paper p-5 pb-8"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-serif text-xl">Filters</p>
                <button
                  type="button"
                  className="btn min-h-10 px-4 py-1.5"
                  onClick={() => setDrawer(false)}
                >
                  Show {shown.length}
                </button>
              </div>
              {filters}
            </div>
          </div>
        ) : null}
        <div>
          {shown.length ? (
            <GsapStaggerGrid
              watch={shown.map((p) => p.id).join()}
              className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4"
            >
              {shown.map((p) => (
                <ProductCard key={p.id} product={p} heading="h2" />
              ))}
            </GsapStaggerGrid>
          ) : (
            <div className="panel space-y-2 text-center">
              <p className="font-serif text-xl">Nothing matches yet.</p>
              <p className="text-sm text-muted">Try another word, or clear a filter.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

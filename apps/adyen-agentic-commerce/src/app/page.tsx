// Spec: knowledge/components/agentic-storefront.md
import Link from "next/link";
import { AskButton } from "@/components/ask/AskButton";
import { GsapHero } from "@/components/motion/GsapHero";
import { GsapReveal } from "@/components/motion/GsapReveal";
import { GsapStaggerGrid } from "@/components/motion/GsapStaggerGrid";
import { cardOf } from "@/components/cardOf";
import { ProductCard } from "@/components/ProductCard";
import { CATEGORIES, PRODUCTS, productById, variantsOf } from "@/server/catalog/catalog";
import { config } from "@/server/core/config";

// PUBLIC_ORIGIN is read per request so one page serves any origin.
export const dynamic = "force-dynamic";

// The piece each department shows on its tile.
const FACE: Record<string, string> = {
  clothing: "velune-wool-blazer",
  footwear: "velune-chelsea-boots",
  bags: "velune-crossbody",
  accessories: "velune-silk-scarf",
  essentials: "velune-jersey-tee",
};

const art = (productId: string, colour = 0) => {
  const product = productById(productId);
  const variant = product
    ? variantsOf(product).find((v) => v.colour.id === product.colours[colour]?.id)
    : undefined;
  return variant ? `/api/art/${variant.id}.svg` : "";
};

const PROMPTS = [
  "Find me a gift under €100",
  "What goes with the linen trench?",
  "Pack a weekend bag for Lisbon in May",
];

export default function Home() {
  const origin = config().publicOrigin;
  const rank = { New: 0, Bestseller: 1, Sale: 2 } as const;
  const trending = PRODUCTS.filter((p) => p.badge)
    .sort((a, b) => rank[a.badge ?? "Sale"] - rank[b.badge ?? "Sale"])
    .slice(0, 8);
  return (
    <div className="space-y-20 sm:space-y-28">
      <GsapHero className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12">
        <div className="space-y-6">
          <p data-hero="line" className="eyebrow">
            The new season · 30 pieces
          </p>
          <h1 data-hero="line" className="text-5xl leading-[1.02] sm:text-6xl lg:text-7xl">
            Quiet pieces, made to last.
          </h1>
          <p data-hero="line" className="max-w-lg text-lg text-muted">
            Linen, merino and leather, most of it made in Portugal, Italy and Spain. Shop it
            yourself, ask your Personal Shopper, or let your own AI agent buy for you.
          </p>
          <div data-hero="line" className="flex flex-wrap gap-3">
            <Link href="/shop?collection=new" className="btn">
              Shop new in
            </Link>
            <AskButton question="Help me pick an outfit for spring">
              Ask your Personal Shopper
            </AskButton>
          </div>
        </div>
        <div
          data-hero="art"
          className="overflow-hidden rounded-[2rem] border border-line bg-[#f4f1ec]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
          <img
            src={art("velune-trench")}
            alt="The linen-blend trench coat in sand"
            width={640}
            height={640}
            className="aspect-square w-full"
            fetchPriority="high"
          />
        </div>
      </GsapHero>

      <GsapReveal as="section" className="space-y-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-3xl">Shop by department</h2>
          <Link href="/shop" className="text-sm underline">
            All {PRODUCTS.length} pieces
          </Link>
        </div>
        <GsapStaggerGrid className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/shop?category=${c.id}`}
              className="group relative block overflow-hidden rounded-2xl border border-line bg-[#f4f1ec]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
              <img
                src={art(FACE[c.id] ?? "", 0)}
                alt=""
                width={320}
                height={320}
                loading="lazy"
                className="aspect-square w-full transition duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              <span className="absolute inset-x-3 bottom-3 flex items-baseline justify-between rounded-xl bg-card/90 px-3 py-2 backdrop-blur">
                <span className="font-serif text-lg">{c.label}</span>
                <span className="text-xs text-muted tabular-nums">
                  {PRODUCTS.filter((p) => p.category === c.id).length}
                </span>
              </span>
            </Link>
          ))}
        </GsapStaggerGrid>
      </GsapReveal>

      <GsapReveal as="section" className="space-y-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-3xl">New &amp; trending</h2>
          <Link href="/shop?sort=new" className="text-sm underline">
            See more
          </Link>
        </div>
        <GsapStaggerGrid className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
          {trending.map((p) => (
            <ProductCard key={p.id} product={cardOf(p)} />
          ))}
        </GsapStaggerGrid>
      </GsapReveal>

      <GsapReveal
        as="section"
        className="grid items-center gap-8 rounded-[2rem] border border-line bg-card p-6 sm:p-10 md:grid-cols-2"
      >
        <div className="space-y-4">
          <p className="eyebrow">Personal Shopper</p>
          <h2 className="text-3xl sm:text-4xl">A boutique adviser, in the corner of every page.</h2>
          <p className="text-muted">
            It knows the collection, your bag and the piece you are looking at. Signed in, it never
            asks who you are, and with a budget you set it can pay with a card you saved.
          </p>
        </div>
        <ul className="grid gap-2">
          {PROMPTS.map((q) => (
            <li key={q}>
              <AskButton
                question={q}
                className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-left text-sm hover:border-ink"
              >
                <span>“{q}”</span>
                <span aria-hidden="true">→</span>
              </AskButton>
            </li>
          ))}
        </ul>
      </GsapReveal>

      <GsapReveal as="section" className="space-y-8 rounded-[2rem] bg-ink p-6 text-paper sm:p-10">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-70">
            Built for humans &amp; AI agents
          </p>
          <h2 className="text-3xl sm:text-4xl">One store, three ways in.</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <h3 className="text-xl">Shop it yourself</h3>
            <p className="text-sm opacity-80">
              Browse, fill your bag and pay with Adyen Drop-in. Test cards only: nothing ships.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl">Send your agent</h3>
            <p className="text-sm opacity-80">
              ChatGPT, Claude or any MCP client connects at{" "}
              <span className="rounded bg-paper/15 px-1.5 py-0.5 font-mono text-[0.85em] break-all">
                {origin}/mcp
              </span>{" "}
              and pays within the budget you approve.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl">Read the feed</h3>
            <p className="text-sm opacity-80">
              Every variant as an OpenAI product feed, in{" "}
              <a href="/api/feeds/openai.json" className="underline">
                JSON
              </a>{" "}
              or{" "}
              <a href="/api/feeds/openai.jsonl" className="underline">
                JSONL
              </a>
              , and over UCP.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/agents" className="btn bg-paper text-ink">
            Connect an agent
          </Link>
          <Link href="/docs" className="btn-ghost border-paper/30 bg-transparent text-paper">
            Technical docs
          </Link>
        </div>
      </GsapReveal>
    </div>
  );
}

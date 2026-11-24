// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { PRODUCTS } from "@/server/catalog/catalog";
import { config } from "@/server/core/config";

// PUBLIC_ORIGIN is read per request so one image serves any origin.
export const dynamic = "force-dynamic";

export default function Home() {
  const origin = config().publicOrigin;
  const featured = [
    "velune-trench",
    "velune-crossbody",
    "velune-silk-scarf",
    "velune-merino-crew",
  ].map((id) => PRODUCTS.find((p) => p.id === id)!);
  return (
    <div className="space-y-14">
      <section className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <h1 className="text-4xl leading-[1.08] sm:text-5xl">
            A store your AI agent can shop for you.
          </h1>
          <p className="max-w-xl text-muted">
            Shop it yourself, or give an AI assistant such as ChatGPT the address{" "}
            <span className="code">{origin}/mcp</span>. You approve it once, set what it may spend,
            and it pays with a card you saved here.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/shop" className="btn">
              Shop the collection
            </Link>
            <Link href="/agents" className="btn-ghost">
              Connect an agent
            </Link>
          </div>
        </div>
        <ol className="panel space-y-4 text-sm">
          {[
            ["Find", "Your agent reads what the store sells and how to sign in."],
            ["Ask", "You approve what it may do and how much it may spend."],
            ["Shop", "It searches the catalogue, fills a cart and opens a checkout."],
            ["Pay", "It pays with your saved card, or sends you a link to pay yourself."],
          ].map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line font-serif">
                {i + 1}
              </span>
              <span>
                <strong className="font-medium">{title}.</strong>{" "}
                <span className="text-muted">{text}</span>
              </span>
            </li>
          ))}
          <li className="border-t border-line pt-3">
            <Link href="/docs" className="underline">
              See each step in the Docs
            </Link>
          </li>
        </ol>
      </section>
      <section className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl">New this season</h2>
          <Link href="/shop" className="text-sm underline">
            See all {PRODUCTS.length}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          {featured.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </div>
  );
}

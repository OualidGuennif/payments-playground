// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { PRODUCTS } from "@/server/catalog";
import { config } from "@/server/config";

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
            Browse it yourself, or point any MCP-capable assistant at{" "}
            <span className="code">{origin}/mcp</span>. It signs in with your consent and a spend
            limit, builds a checkout over UCP, and pays with the card you saved, on Adyen TEST.
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
            [
              "Discover",
              "/.well-known/poppy.json and /.well-known/ucp describe the store, its APIs and its sign-in.",
            ],
            [
              "Sign in",
              "OAuth with PKCE, or a code you type at /device. You approve each scope and set what the agent may spend.",
            ],
            [
              "Shop",
              "Catalogue, cart and checkout over UCP 2026-08-25, by REST or MCP tools, or with WebMCP tools in your browser.",
            ],
            [
              "Pay",
              "Your saved card, charged by the merchant with ContAuth on Adyen TEST, or you pay at the link.",
            ],
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

// Spec: knowledge/components/agentic-storefront.md
// The store's footer: the brand, the departments, the developer links, then one quiet line with
// the sandbox line and the terms (owner, 2026-11-27: no protocol versions, nothing else).
import Link from "next/link";
import { DEVELOPER_LINKS } from "@/lib/developerLinks";

const LINK = "inline-flex min-h-11 items-center text-sm text-muted hover:text-ink";

export function SiteFooter({ departments }: { departments: [string, string][] }) {
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-8 px-4 py-12 sm:grid-cols-[1.6fr_1fr_1fr] sm:px-6">
        <div className="col-span-2 space-y-3 sm:col-span-1">
          <Link href="/" className="font-serif text-xl uppercase tracking-[0.22em]">
            Atelier Velune
          </Link>
          <p className="max-w-xs text-sm text-muted">
            A demo fashion store you can shop yourself or through your AI agent.
          </p>
        </div>
        <nav aria-label="Shop" className="space-y-1">
          <p className="eyebrow">Shop</p>
          <ul>
            {departments.map(([href, label]) => (
              <li key={href}>
                <Link href={href} className={LINK}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Developers" className="space-y-1">
          <p className="eyebrow">Developers</p>
          <ul>
            {DEVELOPER_LINKS.map(([href, label]) => (
              <li key={href}>
                <a href={href} className={LINK}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 text-xs text-muted sm:px-6">
          <p className="py-2">A fictional store on Adyen TEST, a sandbox for demos and play.</p>
          <Link href="/legal" className="inline-flex min-h-11 items-center hover:text-ink">
            Terms, privacy and returns
          </Link>
        </div>
      </div>
    </footer>
  );
}

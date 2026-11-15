// Spec: knowledge/components/adyen-agentic-commerce.md
import type { Metadata } from "next";
import Link from "next/link";
import { CartLink } from "@/components/CartLink";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Atelier Velune · Agentic Commerce", template: "%s · Atelier Velune" },
  description: "A demo fashion store that any AI agent can shop through UCP and PAP, paid on Adyen TEST.",
};

const NAV = [
  ["/shop", "Shop"],
  ["/agents", "For agents"],
  ["/account", "Account"],
  ["/back-office", "Back Office"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className="border-b border-line bg-ink py-1.5 text-center text-xs text-paper">
          Demo store on Adyen <strong>TEST</strong>: no real money moves and nothing ships.
        </div>
        <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="font-serif text-xl tracking-tight">Atelier Velune</Link>
            <nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm sm:gap-3">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="rounded-full px-2 py-1.5 hover:bg-line/60 sm:px-3">{label}</Link>
              ))}
              <CartLink />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
        <footer className="border-t border-line py-8 text-xs text-muted">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 sm:px-6">
            <span>Atelier Velune is a fictional brand. Drawings are original.</span>
            <span>UCP 2026-08-25 · PAP 1.0 · Adyen Web 6.48.1 · Checkout API v72</span>
            <Link href="/legal" className="underline">Terms and privacy</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}

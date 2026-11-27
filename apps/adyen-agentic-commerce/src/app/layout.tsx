// Spec: knowledge/components/adyen-agentic-commerce.md
import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { AskLauncher, AskPanel } from "@/components/ask/AskPanel";
import { CartLink } from "@/components/CartLink";
import { DevelopersMenu } from "@/components/DevelopersMenu";
import { MobileMenu } from "@/components/MobileMenu";
import { SeasonalAmbience } from "@/components/motion/SeasonalAmbience";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { WebMcpTools } from "@/components/WebMcpTools";
import { DEVELOPER_LINKS } from "@/lib/developerLinks";
import { seasonFor } from "@/lib/seasons";
import { THEME_SCRIPT } from "@/lib/theme";
import { CATEGORIES } from "@/server/catalog/catalog";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Atelier Velune · Agentic Commerce", template: "%s · Atelier Velune" },
  description:
    "A demo fashion store that any AI agent can shop through UCP and PAP, paid on Adyen TEST.",
};

// The season shows on every page, so no page may keep the season of its build (ADR-020).
export const dynamic = "force-dynamic";

// The shop's departments, in the catalogue's order, after the new pieces.
const NAV: [string, string][] = [
  ["/shop?collection=new", "New"],
  ...CATEGORIES.map((c): [string, string] => [`/shop?category=${c.id}`, c.label]),
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read per request on the server and handed down, so the browser never computes a second season.
  const season = seasonFor();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string, no shopper data. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-paper"
        >
          Skip to content
        </a>
        <SeasonalAmbience seasonId={season.id} />
        <p className="truncate bg-ink px-4 py-1.5 text-center text-[11px] tracking-[0.08em] text-paper">
          <span className="hidden sm:inline">{season.bannerTagline}</span>
          <span className="sm:hidden">{season.bannerCompact}</span>
        </p>
        {/* Layers (storefront spec): ambience 10, minimised Shopper 30, header and its menus 40,
            open Shopper 50, Pay email modal 60. One line on every width: nothing wraps. */}
        <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-nowrap items-center gap-2 px-3 py-2.5 sm:px-6">
            <Link
              href="/"
              className="shrink-0 whitespace-nowrap font-serif text-base uppercase tracking-[0.22em] sm:text-xl"
              aria-label="Atelier Velune, home"
            >
              <span className="header-wordmark-long hidden sm:inline">Atelier </span>Velune
            </Link>
            <nav
              aria-label="Departments"
              className="header-departments mx-auto hidden items-center gap-0.5 text-sm xl:flex"
            >
              {NAV.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-10 items-center rounded-full px-3 py-1.5 hover:bg-line/60"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="header-actions ml-auto flex shrink-0 flex-nowrap items-center gap-1 sm:gap-2 xl:ml-0">
              <AskLauncher />
              <DevelopersMenu />
              <div className="hidden sm:block">
                <ThemeSwitch />
              </div>
              <CartLink />
              <AccountMenu />
              <MobileMenu>
                <summary
                  className="btn-ghost min-h-11 list-none whitespace-nowrap px-2.5 py-1.5 text-[13px] sm:px-3.5 sm:text-sm [&::-webkit-details-marker]:hidden"
                  aria-label="Open menu"
                >
                  Menu
                </summary>
                <nav
                  aria-label="Mobile navigation"
                  className="absolute right-0 top-[calc(100%+8px)] z-30 grid max-h-[80dvh] w-72 gap-0.5 overflow-y-auto rounded-2xl border border-line bg-card p-2 shadow-lg"
                >
                  <p className="eyebrow px-3.5 pt-2 pb-1">Shop</p>
                  {NAV.map(([href, label]) => (
                    <Link
                      key={href}
                      href={href}
                      className="flex min-h-11 items-center rounded-xl px-3.5 py-2 text-sm font-medium hover:bg-line/60"
                    >
                      {label}
                    </Link>
                  ))}
                  <hr className="my-1 border-line" />
                  <p className="eyebrow px-3.5 pt-2 pb-1">Developers</p>
                  {DEVELOPER_LINKS.map(([href, label]) => (
                    <a
                      key={href}
                      href={href}
                      className="flex min-h-11 items-center rounded-xl px-3.5 py-2 text-sm hover:bg-line/60"
                    >
                      {label}
                    </a>
                  ))}
                  <div className="flex min-h-11 items-center justify-between px-3.5 text-sm sm:hidden">
                    Theme
                    <ThemeSwitch />
                  </div>
                </nav>
              </MobileMenu>
            </div>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
        <WebMcpTools />
        <AskPanel />
        <footer className="border-t border-line py-8 text-xs text-muted">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 sm:px-6">
            <span>Atelier Velune is a fictional brand. Drawings are original.</span>
            <span>
              Demo store on Adyen <strong>TEST</strong>: no real money moves and nothing ships.
            </span>
            <a
              href="/api/feeds/openai.json"
              className="inline-flex min-h-11 items-center underline"
            >
              Product feed
            </a>
            <span>UCP 2026-08-25 · PAP 1.0 · Adyen Web 6.48.1 · Checkout API v72</span>
            <Link href="/legal" className="inline-flex min-h-11 items-center underline">
              Terms, privacy and returns
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}

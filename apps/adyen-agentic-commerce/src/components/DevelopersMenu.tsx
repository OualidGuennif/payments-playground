"use client";
// Spec: knowledge/components/agentic-storefront.md
// The header's door to the store's technical side, kept apart from shopping.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { DEVELOPER_LINKS } from "@/lib/developerLinks";
import { useHeaderMenu } from "./useHeaderMenu";

const ITEM = "flex min-h-11 flex-col justify-center rounded-xl px-3 py-2 hover:bg-line/60";

export function DevelopersMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useHeaderMenu(menu);
  useEffect(() => {
    if (menu.current && pathname) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (event: Event) => {
      const box = menu.current;
      if (!box?.open) return;
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.contains(event.target as Node)
      )
        box.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={menu} className="header-developers relative hidden lg:block">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full px-3 text-sm hover:bg-line/60 [&::-webkit-details-marker]:hidden">
        Developers
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </summary>
      <nav
        aria-label="Developers"
        className="absolute right-0 top-[calc(100%+8px)] z-30 grid w-72 gap-0.5 rounded-2xl border border-line bg-card p-2 shadow-lg"
      >
        {DEVELOPER_LINKS.map(([href, label, hint]) =>
          href.startsWith("/api/") ? (
            <a key={href} href={href} className={ITEM}>
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted">{hint}</span>
            </a>
          ) : (
            <Link key={href} href={href} className={ITEM}>
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted">{hint}</span>
            </Link>
          ),
        )}
      </nav>
    </details>
  );
}

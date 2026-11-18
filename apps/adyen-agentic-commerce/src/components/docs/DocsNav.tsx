// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// A side list from lg up, a row of pills above the page on a phone.
export function DocsNav({ items }: { items: [href: string, label: string][] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Docs"
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:sticky lg:top-24 lg:self-start"
    >
      <ul className="flex w-max gap-2 lg:w-auto lg:flex-col lg:gap-1">
        {items.map(([href, label]) => {
          const here = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={here ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium lg:flex lg:rounded-xl lg:border-transparent ${
                  here
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-card hover:border-ink lg:bg-transparent lg:hover:bg-line/50"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

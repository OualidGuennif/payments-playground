"use client";
// Spec: knowledge/components/adyen-agentic-commerce.md
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

// The root layout survives client navigation, and so would an open menu over the next page.
export function MobileMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (menu.current && pathname) menu.current.open = false;
  }, [pathname]);
  return (
    <details ref={menu} className="relative xl:hidden">
      {children}
    </details>
  );
}

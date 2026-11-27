"use client";
// Spec: knowledge/components/adyen-agentic-commerce.md
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { useHeaderMenu } from "./useHeaderMenu";

// The root layout survives client navigation, and so would an open menu over the next page.
export function MobileMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useHeaderMenu(menu);
  useEffect(() => {
    if (menu.current && pathname) menu.current.open = false;
  }, [pathname]);
  return (
    <details ref={menu} className="header-menu relative shrink-0 xl:hidden">
      {children}
    </details>
  );
}

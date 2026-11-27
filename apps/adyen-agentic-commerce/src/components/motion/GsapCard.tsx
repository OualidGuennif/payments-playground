"use client";
// Spec: knowledge/components/agentic-storefront.md
// A product card's picture lifts a little under a pointer that hovers; touch and reduced motion
// keep it still.
import { type ReactNode, useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export function GsapCard({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    (_context, contextSafe) => {
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (hover: hover)`, () => {
        const art = root.current?.querySelector("[data-card='art']");
        if (!art || !contextSafe) return;
        const enter = contextSafe(() =>
          gsap.to(art, { scale: 1.04, y: -4, duration: 0.45, ease: "power2.out" }),
        );
        const leave = contextSafe(() =>
          gsap.to(art, { scale: 1, y: 0, duration: 0.45, ease: "power2.out" }),
        );
        root.current?.addEventListener("pointerenter", enter);
        root.current?.addEventListener("pointerleave", leave);
        return () => {
          root.current?.removeEventListener("pointerenter", enter);
          root.current?.removeEventListener("pointerleave", leave);
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

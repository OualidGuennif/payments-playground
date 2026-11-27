"use client";
// Spec: knowledge/components/agentic-storefront.md
// A grid whose items arrive one after another when it scrolls into view. `watch` replays the
// arrival when the items change (a filter), so the new set does not pop in.
import { type ReactNode, useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export function GsapStaggerGrid({
  children,
  className,
  watch,
}: {
  children: ReactNode;
  className?: string;
  watch?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = root.current ? Array.from(root.current.children) : [];
        if (!items.length) return;
        gsap.from(items, {
          autoAlpha: 0,
          y: 22,
          duration: 0.55,
          ease: "power2.out",
          stagger: 0.06,
          scrollTrigger: { trigger: root.current, start: "top 90%", once: true },
        });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [watch], revertOnUpdate: true },
  );
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

"use client";
// Spec: knowledge/components/agentic-storefront.md
// The home page's opening: the lines marked data-hero="line" come up in order, the picture
// marked data-hero="art" settles in, then drifts slowly with the scroll.
import { type ReactNode, useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export function GsapHero({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
        timeline
          .from("[data-hero='line']", { autoAlpha: 0, y: 26, duration: 0.8, stagger: 0.1 })
          .from(
            "[data-hero='art']",
            { autoAlpha: 0, scale: 0.94, duration: 1, ease: "power2.out" },
            0.15,
          );
        gsap.to("[data-hero='art']", {
          yPercent: 8,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: 1 },
        });
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

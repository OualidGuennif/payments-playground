"use client";
// Spec: knowledge/components/agentic-storefront.md
// Slides its element up from the bottom edge each time `open` turns true (a sheet on phones, the
// shop's filter drawer). With reduced motion it simply appears.
import { useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export function useSheetMotion<T extends HTMLElement>(open: boolean, key?: string) {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      if (!open || !ref.current) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(ref.current, { yPercent: 100, duration: 0.42, ease: "power3.out" });
      });
      return () => mm.revert();
    },
    { dependencies: [open, key], revertOnUpdate: true },
  );
  return ref;
}

// The shake a field gets when Pay finds it wrong; a no-op with reduced motion.
export function shake(element: Element | null) {
  if (!element) return;
  const mm = gsap.matchMedia();
  mm.add(MOTION_OK, () => {
    gsap.fromTo(
      element,
      { x: 0 },
      { x: 0, duration: 0.42, ease: "none", keyframes: { x: [0, -8, 8, -6, 6, -3, 0] } },
    );
  });
  setTimeout(() => mm.revert(), 600);
}

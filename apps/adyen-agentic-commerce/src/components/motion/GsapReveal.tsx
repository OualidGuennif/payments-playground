"use client";
// Spec: knowledge/components/agentic-storefront.md
// A section that rises into place the first time it scrolls into view.
import { type ReactNode, useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export function GsapReveal({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
}) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(root.current, {
          autoAlpha: 0,
          y: 28,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: root.current, start: "top 88%", once: true },
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );
  return (
    <Tag ref={root} className={className}>
      {children}
    </Tag>
  );
}

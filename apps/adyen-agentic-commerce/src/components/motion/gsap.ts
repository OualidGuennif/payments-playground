"use client";
// Spec: knowledge/components/agentic-storefront.md
// GSAP for the storefront, registered once. Every animation runs inside `motionOK`, a matchMedia
// condition that is false under prefers-reduced-motion: reduce (spec invariant 3), so with reduced
// motion, or before the script runs, the page shows its content in place.
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger);

export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

export { gsap, ScrollTrigger, useGSAP };

"use client";
// Spec: knowledge/components/agentic-storefront.md
// Opens the Personal Shopper with a question in its composer; the shopper sends it.
import type { ReactNode } from "react";
import { askAbout } from "./askClient";

export function AskButton({
  question,
  children,
  className = "btn-ghost",
}: {
  question: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" className={className} onClick={() => askAbout(question)}>
      {children}
    </button>
  );
}

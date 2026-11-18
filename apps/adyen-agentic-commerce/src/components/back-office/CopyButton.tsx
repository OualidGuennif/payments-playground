// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy JSON" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  }
  return (
    <button type="button" onClick={copy} className="btn-ghost min-h-9 px-3 py-1 text-xs">
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      </span>
    </button>
  );
}

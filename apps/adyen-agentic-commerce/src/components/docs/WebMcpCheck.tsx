// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useEffect, useState } from "react";

// Reads one property of this page's document; it sends nothing anywhere.
export function WebMcpCheck() {
  const [present, setPresent] = useState<boolean>();
  useEffect(() => setPresent("modelContext" in document), []);
  return (
    <section className="panel space-y-1" aria-live="polite">
      <h2 className="text-lg">In this browser</h2>
      <p className="text-sm text-muted">
        {present === undefined
          ? "Checking…"
          : present
            ? "This browser exposes document.modelContext: an agent built into it can use this store's five tools on the shop pages."
            : "This browser does not expose document.modelContext. Chrome's origin trial or chrome://flags/#enable-webmcp-testing turns it on."}
      </p>
    </section>
  );
}

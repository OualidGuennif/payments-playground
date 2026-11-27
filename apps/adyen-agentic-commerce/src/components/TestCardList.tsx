"use client";
// Spec: knowledge/components/agentic-storefront.md
// Adyen TEST cards one tap above Drop-in: each number copies without its spaces, so it pastes into
// the card field as one string.
import { useState } from "react";
import { TEST_CARDS, THREEDS_TEST_PASSWORD } from "@/lib/testCards";

export function TestCardList() {
  const [copied, setCopied] = useState<string>();
  const copy = async (pan: string) => {
    try {
      await navigator.clipboard.writeText(pan.replace(/\s/g, ""));
      setCopied(pan);
      setTimeout(() => setCopied((now) => (now === pan ? undefined : now)), 1600);
    } catch {
      // Clipboard access refused: the number stays readable on the page.
    }
  };
  return (
    <details className="group rounded-xl border border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium">
        Test cards
        <span className="text-xs text-muted group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <ul className="divide-y divide-line border-t border-line text-sm">
        {TEST_CARDS.map((card) => (
          <li key={card.pan} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {card.scheme}
                {card.note ? <span className="font-normal text-muted"> · {card.note}</span> : null}
              </p>
              <p className="font-mono text-xs tabular-nums">
                {card.pan}{" "}
                <span className="text-muted">
                  · {card.expiry} · CVC {card.cvc}
                </span>
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost min-h-9 px-3 py-1 text-xs"
              onClick={() => void copy(card.pan)}
              aria-label={`Copy the ${card.scheme} test number`}
            >
              {copied === card.pan ? "Copied" : "Copy"}
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
        3DS Password: <span className="font-mono text-ink">{THREEDS_TEST_PASSWORD}</span>
      </p>
      <p className="sr-only" role="status">
        {copied ? "Number copied" : ""}
      </p>
    </details>
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { treaty } from "@elysiajs/eden";
import { useCallback, useEffect, useState } from "react";
import type { App } from "@/server/api";

// Typed calls from the browser to the Elysia API; only types cross this import.
export const api = () => treaty<App>(window.location.origin).api;

export type CartLine = { variantId: string; quantity: number };
const KEY = "velune-cart";

function read(): CartLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((l) => typeof l?.variantId === "string") : [];
  } catch {
    return [];
  }
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    setLines(read());
    const sync = () => setLines(read());
    window.addEventListener("velune-cart", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("velune-cart", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const save = useCallback((next: CartLine[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: the cart lives for this page only */
    }
    setLines(next);
    window.dispatchEvent(new Event("velune-cart"));
  }, []);
  const add = useCallback(
    (variantId: string, quantity = 1) => {
      const current = read();
      const found = current.find((l) => l.variantId === variantId);
      save(
        found
          ? current.map((l) =>
              l.variantId === variantId
                ? { ...l, quantity: Math.min(10, l.quantity + quantity) }
                : l,
            )
          : [...current, { variantId, quantity }],
      );
    },
    [save],
  );
  const setQuantity = useCallback(
    (variantId: string, quantity: number) => {
      save(
        read()
          .map((l) => (l.variantId === variantId ? { ...l, quantity } : l))
          .filter((l) => l.quantity > 0),
      );
    },
    [save],
  );
  const clear = useCallback(() => save([]), [save]);
  return { lines, add, setQuantity, clear, count: lines.reduce((n, l) => n + l.quantity, 0) };
}

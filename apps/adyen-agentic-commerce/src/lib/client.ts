// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { treaty } from "@elysiajs/eden";
import { useCallback, useEffect, useState } from "react";
import type { App } from "@/server/api";

// Typed calls from the browser to the Elysia API; only types cross this import.
export const api = () => treaty<App>(window.location.origin).api;

export type CartLine = { variantId: string; quantity: number };
const KEY = "velune-cart";
const EVENT = "velune-cart";
export const MAX_QUANTITY = 10;
// The cart form's prefilled receipt address; an agent that knows the shopper's may send it.
export const DEMO_EMAIL = "shopper@example.com";

// Where localStorage throws (private mode), the cart lives in this page's memory instead.
let memory: CartLine[] = [];

export function readCart(): CartLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((l) => typeof l?.variantId === "string") : [];
  } catch {
    return memory;
  }
}

// Every writer goes through here, so the header count and the cart page follow the page's
// WebMCP tools as they follow the buttons.
function writeCart(next: CartLine[]): CartLine[] {
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: memory holds it */
  }
  window.dispatchEvent(new Event(EVENT));
  return next;
}

export function addToCart(variantId: string, quantity = 1): CartLine[] {
  const current = readCart();
  const found = current.find((l) => l.variantId === variantId);
  return writeCart(
    found
      ? current.map((l) =>
          l.variantId === variantId
            ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + quantity) }
            : l,
        )
      : [...current, { variantId, quantity: Math.min(MAX_QUANTITY, quantity) }],
  );
}

export function setCartQuantity(variantId: string, quantity: number): CartLine[] {
  return writeCart(
    readCart()
      .map((l) => (l.variantId === variantId ? { ...l, quantity } : l))
      .filter((l) => l.quantity > 0),
  );
}

export const clearCart = (): CartLine[] => writeCart([]);

// The Ask panel's bag changed: the site's bag takes its lines, and an open checkout page hears it.
export const BAG_EVENT = "velune-bag";
export type BagChange = { lines: CartLine[]; checkoutId?: string; paid: boolean };
export function followBag(change: BagChange): void {
  writeCart(
    change.paid
      ? []
      : change.lines.map((l) => ({ ...l, quantity: Math.min(MAX_QUANTITY, l.quantity) })),
  );
  window.dispatchEvent(new CustomEvent<BagChange>(BAG_EVENT, { detail: change }));
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    setLines(readCart());
    const sync = () => setLines(readCart());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const add = useCallback((variantId: string, quantity = 1) => {
    addToCart(variantId, quantity);
  }, []);
  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setCartQuantity(variantId, quantity);
  }, []);
  const clear = useCallback(() => {
    clearCart();
  }, []);
  return { lines, add, setQuantity, clear, count: lines.reduce((n, l) => n + l.quantity, 0) };
}

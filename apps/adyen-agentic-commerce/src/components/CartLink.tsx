// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useCart } from "@/lib/client";

export function CartLink() {
  const { count } = useCart();
  return (
    <Link
      href="/cart"
      className="btn-ghost px-3 py-1.5"
      aria-label={`Bag, ${count} item${count === 1 ? "" : "s"}`}
    >
      Bag <span className="tabular-nums">{count}</span>
    </Link>
  );
}

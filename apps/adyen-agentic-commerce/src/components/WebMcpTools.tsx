// Spec: knowledge/components/adyen-agentic-commerce.md
// Registers the store's WebMCP tools while a shopping page is open in a browser that has
// document.modelContext; elsewhere it does nothing. Renders nothing.
"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { addToCart, api, clearCart, DEMO_EMAIL, readCart, setCartQuantity } from "@/lib/client";
import {
  type CatalogProduct,
  type ModelContext,
  registerAll,
  shopTools,
  toolsAllowedOn,
} from "@/lib/webmcp";

// document.modelContext is the draft's entry point; navigator.modelContext is its deprecated one,
// still on earlier Chrome builds.
function modelContext(): ModelContext | undefined {
  const found =
    (document as { modelContext?: ModelContext }).modelContext ??
    (navigator as { modelContext?: ModelContext }).modelContext;
  return typeof found?.registerTool === "function" ? found : undefined;
}

async function catalog(
  filters: { q?: string; category?: string; maxPrice?: number },
  signal?: AbortSignal,
): Promise<CatalogProduct[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.maxPrice !== undefined) params.set("max_price", String(filters.maxPrice));
  const response = await fetch(`/api/catalog?${params}`, { signal });
  if (!response.ok) throw new Error(`The catalogue answered ${response.status}`);
  return ((await response.json()) as { products: CatalogProduct[] }).products;
}

export function WebMcpTools() {
  const allowed = toolsAllowedOn(usePathname());
  const router = useRouter();
  useEffect(() => {
    const context = allowed ? modelContext() : undefined;
    if (!context) return;
    const controller = new AbortController();
    void registerAll(
      context,
      shopTools({
        catalog,
        cart: { read: readCart, add: addToCart, setQuantity: setCartQuantity, clear: clearCart },
        createCheckout: async (lines, email) => {
          const { data, error } = await api().checkouts.post({
            lines,
            email: email ?? DEMO_EMAIL,
          });
          return !error && data && "id" in data && typeof data.id === "string"
            ? data.id
            : undefined;
        },
        navigate: (path) => router.push(path),
        origin: window.location.origin,
      }),
      controller,
    );
    return () => controller.abort();
  }, [allowed, router]);
  return null;
}

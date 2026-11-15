// Spec: knowledge/components/adyen-agentic-commerce.md
import { CartView } from "@/components/CartView";
import { PRODUCTS, variantsOf } from "@/server/catalog";

export const metadata = { title: "Cart" };

export default function CartPage() {
  // Titles and prices for display only; the server prices the checkout again.
  const variants = Object.fromEntries(
    PRODUCTS.flatMap(variantsOf).map((v) => [v.id, { title: v.title, price: v.price, available: v.available }]),
  );
  return <CartView variants={variants} />;
}

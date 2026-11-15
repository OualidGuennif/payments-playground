// Spec: knowledge/components/adyen-agentic-commerce.md
import { notFound } from "next/navigation";
import { CheckoutPay } from "@/components/CheckoutPay";
import { checkoutView } from "@/server/api";
import { loadCheckout } from "@/server/commerce";

export const metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sessionId?: string; redirectResult?: string }>;
}) {
  const { id } = await params;
  let view;
  try {
    view = checkoutView(loadCheckout(id, "browser"));
  } catch {
    notFound();
  }
  const { sessionId, redirectResult } = await searchParams;
  return <CheckoutPay initial={view} redirect={sessionId && redirectResult ? { sessionId, redirectResult } : undefined} />;
}

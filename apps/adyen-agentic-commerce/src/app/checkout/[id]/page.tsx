// Spec: knowledge/components/adyen-agentic-commerce.md
import { notFound } from "next/navigation";
import { CheckoutPay } from "@/components/CheckoutPay";
import { checkoutView } from "@/server/api";
import { loadCheckout, sessionIdForReference } from "@/server/commerce/commerce";
import { config } from "@/server/core/config";
import { currentCustomer } from "@/lib/session";

export const metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sessionId?: string; redirectResult?: string; ref?: string }>;
}) {
  const { id } = await params;
  let view: ReturnType<typeof checkoutView>;
  try {
    view = checkoutView(loadCheckout(id, "browser"), await currentCustomer());
  } catch {
    notFound();
  }
  const { sessionId, redirectResult, ref } = await searchParams;
  const resolvedSessionId = sessionId ?? sessionIdForReference(ref, { checkoutId: view.id });
  return (
    <CheckoutPay
      initial={view}
      clientKey={config().adyen.clientKey ?? ""}
      redirect={
        resolvedSessionId && redirectResult
          ? { sessionId: resolvedSessionId, redirectResult }
          : undefined
      }
    />
  );
}

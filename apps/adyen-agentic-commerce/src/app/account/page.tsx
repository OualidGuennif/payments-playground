// Spec: knowledge/components/adyen-agentic-commerce.md
import { AccountView } from "@/components/AccountView";
import { requireCustomer } from "@/lib/session";
import { accountView } from "@/server/api";
import { sessionIdForReference } from "@/server/commerce/commerce";
import { config } from "@/server/core/config";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; redirectResult?: string; ref?: string }>;
}) {
  const { sessionId, redirectResult, ref } = await searchParams;
  // Adyen's redirect back keeps its parameters through sign-in.
  const keep = new URLSearchParams();
  if (sessionId) keep.set("sessionId", sessionId);
  if (redirectResult) keep.set("redirectResult", redirectResult);
  if (ref) keep.set("ref", ref);
  const back = keep.size ? `/account?${keep}` : "/account";
  const customer = await requireCustomer(back);
  const resolvedSessionId = sessionId ?? sessionIdForReference(ref, { customerId: customer.id });
  return (
    <AccountView
      initial={await accountView(customer)}
      clientKey={config().adyen.clientKey ?? ""}
      redirect={
        resolvedSessionId && redirectResult
          ? { sessionId: resolvedSessionId, redirectResult }
          : undefined
      }
    />
  );
}

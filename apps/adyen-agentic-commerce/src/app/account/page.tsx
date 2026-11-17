// Spec: knowledge/components/adyen-agentic-commerce.md
import { AccountView } from "@/components/AccountView";
import { requireCustomer } from "@/lib/session";
import { accountView } from "@/server/api";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; redirectResult?: string }>;
}) {
  const { sessionId, redirectResult } = await searchParams;
  // Adyen's redirect back keeps its parameters through sign-in.
  const back =
    sessionId && redirectResult
      ? `/account?${new URLSearchParams({ sessionId, redirectResult })}`
      : "/account";
  const customer = await requireCustomer(back);
  return (
    <AccountView
      initial={await accountView(customer)}
      redirect={sessionId && redirectResult ? { sessionId, redirectResult } : undefined}
    />
  );
}

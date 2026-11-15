// Spec: knowledge/components/adyen-agentic-commerce.md
import { AccountView } from "@/components/AccountView";
import { accountView } from "@/server/api";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; redirectResult?: string }>;
}) {
  const { sessionId, redirectResult } = await searchParams;
  return (
    <AccountView
      initial={await accountView()}
      redirect={sessionId && redirectResult ? { sessionId, redirectResult } : undefined}
    />
  );
}

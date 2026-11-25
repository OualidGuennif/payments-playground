// Spec: knowledge/components/adyen-agentic-commerce.md
import { notFound } from "next/navigation";
import { ConsentForm } from "@/components/ConsentForm";
import { asksToPay, consentRows } from "@/lib/consent";
import { requireCustomer } from "@/lib/session";
import { pendingRequest } from "@/server/oauth/oauth";

export const metadata = { title: "Connect an agent" };
export const dynamic = "force-dynamic";

const hostOf = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

export default async function Consent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A grant belongs to the account that approves it, so the shopper signs in first.
  const customer = await requireCustomer(`/consent/${encodeURIComponent(id)}`);
  const request = pendingRequest(id);
  if (!request) notFound();
  return (
    <ConsentForm
      requestId={request.id}
      agentName={request.clientName}
      email={customer.email}
      clientHost={hostOf(request.clientId) ?? "registered MCP client"}
      // A device request has no callback: the agent polls and gets access on its own.
      returnHost={hostOf(request.redirectUri)}
      rows={consentRows(request.scopes)}
      asksToPay={asksToPay(request.scopes)}
    />
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md
import { notFound } from "next/navigation";
import { pendingRequest, SCOPES } from "@/server/oauth";

export const metadata = { title: "Connect an agent" };
export const dynamic = "force-dynamic";

export default async function Consent({ params }: { params: Promise<{ id: string }> }) {
  const request = pendingRequest((await params).id);
  if (!request) notFound();
  const host = (() => {
    try {
      return new URL(request.clientId).host;
    } catch {
      return "registered MCP client";
    }
  })();
  const redirectHost = new URL(request.redirectUri).host;
  return (
    <form method="post" action="/oauth/decision" className="panel mx-auto max-w-lg space-y-5">
      <input type="hidden" name="request" value={request.id} />
      <div className="space-y-1">
        <p className="eyebrow">Connect an agent</p>
        <h1 className="text-2xl">{request.clientName} wants to shop for you</h1>
        <p className="break-all text-sm text-muted">Client: {host}. You will return to {redirectHost}.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="eyebrow">It asks to</legend>
        {request.scopes.map((scope) => (
          <label key={scope} className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
            <input type="checkbox" name="scope" value={scope} defaultChecked className="mt-0.5" />
            <span>
              {SCOPES[scope].label} <span className="code">{scope}</span>
              {SCOPES[scope].kind === "personal_data" ? <span className="block text-xs text-muted">Shares personal data</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      {request.scopes.includes("ucp:pay")
        ? (
          <label className="block space-y-1 text-sm">
            <span className="eyebrow">Total it may spend (EUR)</span>
            <input type="number" name="spend_limit_eur" min={0} max={1000} step={10} defaultValue={150} className="field" />
            <span className="block text-xs text-muted">Above this, the agent must send you a link to approve and pay yourself.</span>
          </label>
        )
        : <input type="hidden" name="spend_limit_eur" value="0" />}
      <div className="flex gap-3">
        <button type="submit" name="decision" value="approve" className="btn flex-1">Allow</button>
        <button type="submit" name="decision" value="deny" className="btn-ghost flex-1">Deny</button>
      </div>
    </form>
  );
}

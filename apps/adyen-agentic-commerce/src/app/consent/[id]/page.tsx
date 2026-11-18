// Spec: knowledge/components/adyen-agentic-commerce.md
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/session";
import { allows, pendingRequest, type Scope, SCOPES } from "@/server/oauth";

export const metadata = { title: "Connect an agent" };
export const dynamic = "force-dynamic";

// PAP 1.0 §4.7's two hints, in the shopper's words.
function scopeEffect(scope: Scope): string {
  const { changes, personalData } = SCOPES[scope];
  const effect =
    changes === "irreversible"
      ? "Can take actions that cannot be undone"
      : changes === "reversible"
        ? "Can make changes that can be undone"
        : "Only reads";
  return personalData ? `${effect}; sees your personal data` : effect;
}

export default async function Consent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A grant belongs to the account that approves it, so the shopper signs in first.
  const customer = await requireCustomer(`/consent/${encodeURIComponent(id)}`);
  const request = pendingRequest(id);
  if (!request) notFound();
  const host = (() => {
    try {
      return new URL(request.clientId).host;
    } catch {
      return "registered MCP client";
    }
  })();
  // A device request has no callback: the agent polls and gets access on its own.
  const after = request.redirectUri
    ? `You will return to ${new URL(request.redirectUri).host}.`
    : "You typed its code on this site; the agent picks up the answer on its own.";
  return (
    <form method="post" action="/oauth/decision" className="panel mx-auto max-w-lg space-y-5">
      <input type="hidden" name="request" value={request.id} />
      <div className="space-y-1">
        <h1 className="text-2xl">{request.clientName} wants to shop for you</h1>
        <p className="text-sm text-muted">
          Client: <span className="break-all">{host}</span>. {after}
        </p>
        <p className="text-sm text-muted">
          It will act for your account ({customer.email}), with your saved cards.
        </p>
        {/* PAP 1.0 §10.8: whoever started a sign-in gets its tokens, so a link or code someone
            else sent would connect their agent to this account. */}
        <p className="text-sm font-medium">
          Continue only if you just asked {request.clientName} to connect to this store. If you did
          not, choose Deny: someone else may have sent you this {request.device ? "code" : "link"}.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-medium text-muted">It asks to</legend>
        {request.scopes.map((scope) => (
          <label
            key={scope}
            className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm"
          >
            <input type="checkbox" name="scope" value={scope} defaultChecked className="mt-0.5" />
            <span>
              {SCOPES[scope].label} <span className="code break-all">{scope}</span>
              <span className="block text-xs text-muted">{scopeEffect(scope)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {request.scopes.some((s) => allows([s], "ucp:pay")) ? (
        <label className="block space-y-1 text-sm">
          <span className="block text-xs font-medium text-muted">Total it may spend (EUR)</span>
          <input
            type="number"
            name="spend_limit_eur"
            min={0}
            max={1000}
            step={10}
            defaultValue={150}
            className="field"
          />
          <span className="block text-xs text-muted">
            Above this, the agent must send you a link to approve and pay yourself.
          </span>
        </label>
      ) : (
        <input type="hidden" name="spend_limit_eur" value="0" />
      )}
      <div className="flex gap-3">
        <button type="submit" name="decision" value="approve" className="btn flex-1">
          Allow
        </button>
        <button type="submit" name="decision" value="deny" className="btn-ghost flex-1">
          Deny
        </button>
      </div>
    </form>
  );
}

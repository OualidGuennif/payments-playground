// Spec: knowledge/components/adyen-agentic-commerce.md
import { BudgetPicker } from "@/components/BudgetPicker";
import { CHANGE_PILL, type Change, type ConsentRow } from "@/lib/consent";
import { maskEmail } from "@/lib/mask";

const TONE: Record<Change, string> = {
  none: "border-ok text-ok",
  reversible: "border-line text-muted",
  irreversible: "border-warn text-warn",
};

export type ConsentProps = {
  requestId: string;
  agentName: string;
  email: string;
  clientHost: string;
  // Absent for a device request: the agent polls and has no page to return to.
  returnHost?: string;
  rows: ConsentRow[];
  asksToPay: boolean;
};

// A store's permission screen, not an OAuth form: the agent, the account, what it may do in
// words, a budget, two buttons. The protocol facts sit folded under Details.
export function ConsentForm({
  requestId,
  agentName,
  email,
  clientHost,
  returnHost,
  rows,
  asksToPay,
}: ConsentProps) {
  const initial = agentName.trim().charAt(0).toUpperCase() || "?";
  return (
    <form method="post" action="/oauth/decision" className="panel mx-auto max-w-md space-y-6">
      <input type="hidden" name="request" value={requestId} />
      <header className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ink text-2xl font-semibold text-paper"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl leading-tight break-words">{agentName} wants to shop for you</h1>
          <p className="mt-1 text-sm text-muted">Signed in as {maskEmail(email)}</p>
        </div>
      </header>

      {/* PAP 1.0 §10.8: whoever started the sign-in gets the tokens, so a link or code someone
          else sent would connect their agent to this account. */}
      <p className="rounded-xl border border-warn px-3 py-2 text-sm">
        Only allow if you just asked {agentName} to connect.
      </p>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">It will be able to</legend>
        {rows.map((row) => (
          <label
            key={row.scope}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm hover:border-ink"
          >
            <input
              type="checkbox"
              name="scope"
              value={row.scope}
              defaultChecked
              className="mt-0.5 size-4 shrink-0 accent-current"
            />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block">{row.text}</span>
              <span className="flex flex-wrap gap-1.5">
                <span className={`pill ${TONE[row.change]}`}>{CHANGE_PILL[row.change]}</span>
                {row.personal ? (
                  <span className="pill border-line text-muted">Personal data</span>
                ) : null}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {asksToPay ? <BudgetPicker /> : <input type="hidden" name="spend_limit_eur" value="0" />}

      {/* Allow comes first: the first submit button is the one Enter presses in the budget field
          or a phone's Go key, and the shopper on this page came to connect the agent. */}
      <div className="grid grid-cols-2 gap-3">
        <button type="submit" name="decision" value="approve" className="btn">
          Allow
        </button>
        <button type="submit" name="decision" value="deny" className="btn-ghost">
          Deny
        </button>
      </div>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none">Details</summary>
        <ul className="mt-2 space-y-1">
          <li>
            Agent address: <span className="break-all">{clientHost}</span>
          </li>
          <li>
            {returnHost
              ? `After you decide, you go back to ${returnHost}.`
              : "You typed its code here; the agent picks up your answer on its own."}
          </li>
          <li>It acts for this account and pays only with your saved cards.</li>
          <li>You can change its budget or disconnect it from your account at any time.</li>
        </ul>
      </details>
    </form>
  );
}

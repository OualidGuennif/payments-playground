// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useState } from "react";
import type { accountView } from "@/server/api";
import { type Confirm, StepUp } from "@/components/StepUp";
import { type Answer, codeOf, messageOf } from "@/lib/answer";
import { api } from "@/lib/client";
import { money } from "@/lib/money";

type View = Awaited<ReturnType<typeof accountView>>;
type Agent = View["agents"][number];
type Change = { revoked?: boolean; spendLimit?: number; confirm?: Confirm };

// The server's cap, so the confirmation names the limit that will really apply.
const LIMIT_MAX = 100_000;

// Raising a limit lets the agent spend more, so the server asks for the password or a passkey again
// (owner, 2026-11-18); lowering it or disconnecting goes through at once.
export function AgentLimit({
  agent,
  hasPasskey,
  onChange,
}: {
  agent: Agent;
  hasPasskey: boolean;
  onChange: (view: View) => void;
}) {
  const [value, setValue] = useState(String(agent.spendLimit / 100));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const wanted = Math.min(Math.max(Math.round(Number(value) * 100), 0), LIMIT_MAX);

  async function send(change: Change): Promise<string | undefined> {
    setBusy(true);
    try {
      const answer = await api().account.grants({ id: agent.id }).post(change);
      // A limit read before another tab changed it can make a raise look like a lower one: the
      // server then asks for the step-up, so the form opens instead of an error.
      if (!change.confirm && codeOf(answer as Answer) === "confirmation_required") {
        setConfirming(true);
        return undefined;
      }
      const failed = messageOf(answer as Answer, "The change could not be saved.");
      if (failed) return failed;
      const view = answer.data as unknown as View;
      const saved = view.agents.find((a) => a.id === agent.id);
      if (saved) setValue(String(saved.spendLimit / 100));
      setConfirming(false);
      onChange(view);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(undefined);
    if (!value.trim() || !Number.isFinite(Number(value))) setError("Enter the limit in EUR.");
    else if (wanted > agent.spendLimit) setConfirming(true);
    else setError(await send({ spendLimit: wanted }));
  }

  const used = agent.spendLimit > 0 ? Math.min(100, (agent.spent / agent.spendLimit) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-sm font-medium tabular-nums">{money(agent.remaining)} left</span>
        <span className="text-muted tabular-nums">
          {money(agent.spent)} of {money(agent.spendLimit)} spent
        </span>
      </div>
      {/* Sized by SVG attributes: the site has no inline styles. */}
      <svg
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        className="h-1.5 w-full overflow-hidden rounded-full"
        aria-hidden="true"
      >
        <rect width="100" height="4" className="fill-line" />
        <rect width={used} height="4" className={used >= 90 ? "fill-warn" : "fill-accent"} />
      </svg>
      {agent.revoked ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-xs font-medium text-muted">Limit (EUR, up to 1,000)</span>
            <input
              type="number"
              min={0}
              max={LIMIT_MAX / 100}
              step={10}
              inputMode="decimal"
              className="field mt-1 w-28"
              value={value}
              disabled={confirming}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5"
            disabled={busy || confirming}
            onClick={save}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-bad"
            disabled={busy}
            onClick={async () => setError(await send({ revoked: true }))}
          >
            Disconnect
          </button>
        </div>
      )}
      {confirming ? (
        <StepUp
          prompt={`Raising the limit to ${money(wanted)} lets ${agent.name} spend more.`}
          hasPasskey={hasPasskey}
          onConfirm={(confirm) => send({ spendLimit: wanted, confirm })}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {error ? (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

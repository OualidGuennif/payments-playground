// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { accountView } from "@/server/api";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { PasskeysPanel } from "@/components/PasskeysPanel";
import { StatusPill } from "@/components/StatusPill";
import { agentState, agentStory } from "@/lib/agent-status";
import { api } from "@/lib/client";
import { money } from "@/lib/money";

type View = Awaited<ReturnType<typeof accountView>>;

export function AccountView({
  initial,
  redirect,
}: {
  initial: View;
  redirect?: { sessionId: string; redirectResult: string };
}) {
  const [view, setView] = useState(initial);
  const [saving, setSaving] = useState(Boolean(redirect));
  const [note, setNote] = useState<string>();
  const [limits, setLimits] = useState<Record<string, string>>({});

  const createSession = useCallback(async (): Promise<SessionInfo> => {
    const { data, error } = await api().account["card-session"].post();
    if (error || !data || !("sessionData" in data))
      throw new Error("The card form could not be loaded.");
    return data as SessionInfo;
  }, []);

  const onFinished = useCallback(async (sessionId: string, sessionResult: string) => {
    const { data, error } = await api().account["card-result"].post({ sessionId, sessionResult });
    if (error || !data || !("account" in data)) {
      setNote("Adyen did not confirm the card yet. Refresh in a moment.");
      return;
    }
    setView(data.account as View);
    setSaving(false);
    setNote(`Adyen answered: ${data.result}.`);
  }, []);

  async function forget(alias: string) {
    const { data } = await api().account.cards({ alias }).delete();
    if (data && "cards" in data) setView(data as View);
  }

  async function changeGrant(id: string, change: { revoked?: boolean; spendLimit?: number }) {
    const { data } = await api().account.grants({ id }).post(change);
    if (data && "agents" in data) setView(data as View);
  }

  async function signOut() {
    await api().session.delete();
    window.location.assign("/");
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl">Your account</h1>
          <p className="text-sm text-muted">
            Signed in as {view.customer.email}. Adyen shopper reference{" "}
            <span className="code">{view.shopperReference}</span>.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={signOut}>
          Sign out
        </button>
      </div>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="panel space-y-4">
          <h2 className="text-xl">Saved cards</h2>
          <p className="text-sm text-muted">
            Your agents may pay with these, within the limit you set for each one, and Drop-in
            offers them when you pay. Saving one is a zero-value check on Adyen TEST.
          </p>
          {view.cards.length ? (
            <ul className="space-y-2">
              {view.cards.map((c) => (
                <li
                  key={c.alias}
                  className="flex items-center justify-between rounded-xl border border-line p-3 text-sm"
                >
                  <span className="capitalize">
                    {c.brand} •••• {c.lastFour}{" "}
                    <span className="text-muted">
                      {c.expiryMonth}/{c.expiryYear}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="inline-flex min-h-11 cursor-pointer items-center px-2 text-xs underline"
                    onClick={() => forget(c.alias)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No card saved yet.</p>
          )}
          {!view.paymentsReady ? (
            <p className="text-sm text-warn">Payments are not configured on this server.</p>
          ) : saving ? (
            <DropinPanel
              label="Save a card"
              storedMethods={false}
              createSession={createSession}
              onFinished={onFinished}
              redirect={redirect}
            />
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setSaving(true)}>
              {view.cards.length ? "Save another card" : "Save a card"}
            </button>
          )}
          {note ? (
            <p className="text-sm" role="status">
              {note}
            </p>
          ) : null}
        </div>

        <div className="panel space-y-4">
          <h2 className="text-xl">Connected agents</h2>
          {view.agents.length ? (
            <ul className="space-y-3">
              {view.agents.map((a) => (
                <li key={a.id} className="space-y-2 rounded-xl border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-medium">{a.name}</strong>
                    <StatusPill status={agentState(a)} />
                  </div>
                  <p className="text-xs">{agentStory(a)}</p>
                  <p className="break-all text-xs text-muted">{a.clientId}</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs" title={a.scopes.join(" ")}>
                    {a.permissions.map((p, i) => (
                      <li key={a.scopes[i]}>{p}</li>
                    ))}
                  </ul>
                  <p className="text-xs">
                    Spent {money(a.spent)} of {money(a.spendLimit)}
                  </p>
                  {a.revoked ? null : (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs">
                        <span className="block text-xs font-medium text-muted">Limit (EUR)</span>
                        <input
                          type="number"
                          min={0}
                          step={10}
                          className="field mt-1 w-28"
                          value={limits[a.id] ?? String(a.spendLimit / 100)}
                          onChange={(e) => setLimits({ ...limits, [a.id]: e.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5"
                        onClick={() =>
                          changeGrant(a.id, {
                            spendLimit: Math.round(
                              Number(limits[a.id] ?? a.spendLimit / 100) * 100,
                            ),
                          })
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-bad"
                        onClick={() => changeGrant(a.id, { revoked: true })}
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">
              No agent connected. See{" "}
              <Link href="/agents" className="underline">
                For agents
              </Link>
              .
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <PasskeysPanel passkeys={view.passkeys} onChange={setView} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl">Orders</h2>
        {view.orders.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
            {view.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 p-3">
                <Link href={`/orders/${o.id}`} className="font-mono text-xs underline">
                  {o.id}
                </Link>
                <StatusPill status={o.status} />
                <span className="text-muted">
                  {o.channel === "agent" ? `through ${o.agentName ?? "an agent"}` : "on this site"}
                  {o.paidBy === "agent" ? ", paid by the agent" : ", paid by you"}
                </span>
                <span className="ml-auto tabular-nums">{money(o.total)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No order yet.</p>
        )}
      </section>
    </div>
  );
}

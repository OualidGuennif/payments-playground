// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { accountView } from "@/server/api";
import { AgentLimit } from "@/components/AgentLimit";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { PasskeysPanel } from "@/components/PasskeysPanel";
import { StatusPill } from "@/components/StatusPill";
import { agentState, agentStory, when } from "@/lib/agent-status";
import { api } from "@/lib/client";
import { maskEmail } from "@/lib/mask";
import { money } from "@/lib/money";

type View = Awaited<ReturnType<typeof accountView>>;

const SECTIONS = [
  ["overview", "Overview"],
  ["agents", "Agents"],
  ["orders", "Orders"],
  ["cards", "Payment methods"],
  ["security", "Security"],
] as const;

const ORDERS_PER_PAGE = 10;

export function AccountView({
  initial,
  clientKey,
  redirect,
}: {
  initial: View;
  clientKey?: string;
  redirect?: { sessionId: string; redirectResult: string };
}) {
  const [view, setView] = useState(initial);
  const [pendingRedirect, setPendingRedirect] = useState(redirect);
  const [saving, setSaving] = useState(Boolean(redirect));
  const [note, setNote] = useState<string>();
  const [hash, setHash] = useState<string>();
  const [page, setPage] = useState(1);

  // The menu opens a section by its fragment, and an agent's manage_url opens this page at
  // #agent-<grant id>: that agent is the one to look at.
  useEffect(() => {
    const show = () => {
      // Grant ids are plain ASCII, so the fragment is compared as it is, never decoded.
      const id = location.hash.slice(1);
      setHash(id);
      if (id.startsWith("agent-")) document.getElementById(id)?.scrollIntoView({ block: "center" });
    };
    show();
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
  }, []);

  const createSession = useCallback(async (): Promise<SessionInfo> => {
    const { data, error } = await api().account["card-session"].post();
    if (error || !data || !("sessionData" in data))
      throw new Error("The card form could not be loaded.");
    return data as SessionInfo;
  }, []);

  const onFinished = useCallback(async (sessionId: string, sessionResult: string) => {
    if (window.location.search) window.history.replaceState(null, "", "/account#cards");
    const { data, error } = await api().account["card-result"].post({ sessionId, sessionResult });
    if (error || !data || !("account" in data)) {
      setNote("Adyen did not confirm the card yet. Refresh in a moment.");
      window.setTimeout(() => {
        setPendingRedirect(undefined);
        setSaving(false);
      }, 0);
      return;
    }
    setView(data.account as View);
    setNote(
      data.result === "completed" ? "Card saved on Adyen TEST." : `Adyen answered: ${data.result}.`,
    );
    window.setTimeout(() => {
      setPendingRedirect(undefined);
      setSaving(false);
    }, 0);
  }, []);

  async function forget(alias: string) {
    const { data } = await api().account.cards({ alias }).delete();
    if (data && "cards" in data) setView(data as View);
  }

  async function signOut() {
    await api().session.delete();
    window.location.assign("/");
  }

  const active = view.agents.filter((a) => !a.revoked);
  const connected = active.filter((a) => agentState(a) === "connected").length;
  const budgetLeft = active.reduce((sum, a) => sum + a.remaining, 0);
  const lastOrder = view.orders[0];
  const pages = Math.max(1, Math.ceil(view.orders.length / ORDERS_PER_PAGE));
  const shown = view.orders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE);
  const current = hash?.startsWith("agent-") ? "agents" : hash;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl">Your account</h1>
        <p className="text-sm text-muted">
          {view.customer.name} · {maskEmail(view.customer.email)}
        </p>
      </div>

      <nav
        aria-label="Account sections"
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-2">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={current === id ? "location" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
                  current === id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-card hover:border-ink"
                }`}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="overview" aria-labelledby="overview-title" className="scroll-mt-24 space-y-3">
        <h2 id="overview-title" className="sr-only">
          Overview
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile href="#agents" label="Agents" value={String(active.length)}>
            {connected} connected
          </Tile>
          <Tile href="#agents" label="Budget left" value={money(budgetLeft)}>
            {active.length
              ? `across ${active.length} agent${active.length === 1 ? "" : "s"}`
              : "no agent yet"}
          </Tile>
          <Tile href="#cards" label="Saved cards" value={String(view.cards.length)}>
            {view.cards[0]
              ? `${view.cards[0].brand} •••• ${view.cards[0].lastFour}`
              : "none saved yet"}
          </Tile>
          <Tile
            href="#orders"
            label="Last order"
            value={lastOrder ? money(lastOrder.total) : "None"}
          >
            {lastOrder ? when(lastOrder.createdAt) : "nothing ordered yet"}
          </Tile>
        </ul>
      </section>

      <section id="agents" aria-labelledby="agents-title" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="agents-title" className="text-xl">
            Agents
          </h2>
          <Link href="/agents" className="text-sm underline">
            Connect an agent
          </Link>
        </div>
        {view.agents.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {view.agents.map((a) => (
              <li
                key={a.id}
                id={`agent-${a.id}`}
                className={`panel scroll-mt-24 space-y-3 ${
                  hash === `agent-${a.id}` ? "border-accent ring-2 ring-accent" : ""
                } ${a.revoked ? "opacity-75" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink font-semibold text-paper"
                  >
                    {a.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <strong className="min-w-0 flex-1 truncate font-medium">{a.name}</strong>
                  <StatusPill status={agentState(a)} />
                </div>
                <p className="text-xs text-muted">{agentStory(a)}</p>
                <AgentLimit agent={a} hasPasskey={view.passkeys.length > 0} onChange={setView} />
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted select-none">
                    What it can do
                  </summary>
                  <ul className="mt-2 list-disc space-y-0.5 pl-4">
                    {a.permissions.map((p, i) => (
                      <li key={a.scopes[i]}>{p}</li>
                    ))}
                  </ul>
                  <p className="mt-2 break-all text-muted">{a.clientId}</p>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel text-sm">
            No agent yet.{" "}
            <Link href="/agents" className="underline">
              Connect one
            </Link>{" "}
            to let it shop for you.
          </p>
        )}
      </section>

      <section id="orders" aria-labelledby="orders-title" className="scroll-mt-24 space-y-3">
        <h2 id="orders-title" className="text-xl">
          Orders
        </h2>
        {shown.length ? (
          <>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
              {shown.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <Link href={`/orders/${o.id}`} className="font-mono text-xs underline">
                    {o.id}
                  </Link>
                  <StatusPill status={o.status} />
                  <span className="ml-auto font-medium tabular-nums">{money(o.total)}</span>
                  <span className="w-full text-xs text-muted">
                    {when(o.createdAt)},{" "}
                    {o.channel === "agent"
                      ? `through ${o.agentName ?? "an agent"}`
                      : "on this site"}
                    {o.paidBy === "agent" ? ", paid by the agent" : ", paid by you"}
                    {o.discount ? `; welcome offer, ${money(o.discount)} off` : ""}
                    {o.gift ? ` and the ${o.gift}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {pages > 1 ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <button
                  type="button"
                  className="btn-ghost px-4"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span className="text-muted tabular-nums" aria-live="polite">
                  Page {page} of {pages}
                </span>
                <button
                  type="button"
                  className="btn-ghost px-4"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="panel text-sm text-muted">No order yet.</p>
        )}
      </section>

      <section id="cards" aria-labelledby="cards-title" className="panel scroll-mt-24 space-y-4">
        <h2 id="cards-title" className="text-xl">
          Payment methods
        </h2>
        <p className="text-sm text-muted">
          Your agents pay with these, within each one's budget, and Drop-in offers them when you
          pay. Saving a card is a zero-value check on Adyen TEST.
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
            clientKey={clientKey}
            createSession={createSession}
            onFinished={onFinished}
            redirect={pendingRedirect}
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
        <p className="text-xs text-muted">
          Adyen shopper reference <span className="code">{view.shopperReference}</span>
        </p>
      </section>

      <section
        id="security"
        aria-label="Security"
        className="scroll-mt-24 grid gap-6 md:grid-cols-2"
      >
        <PasskeysPanel passkeys={view.passkeys} onChange={setView} />
        <div className="panel space-y-4">
          <h2 className="text-xl">Sign out</h2>
          <p className="text-sm text-muted">
            Signs this browser out. Your agents stay connected until you disconnect them.
          </p>
          <button type="button" className="btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

function Tile({
  href,
  label,
  value,
  children,
}: {
  href: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <a href={href} className="panel block h-full space-y-1 hover:border-ink">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <span className="block truncate text-2xl tabular-nums">{value}</span>
        <span className="block truncate text-xs text-muted">{children}</span>
      </a>
    </li>
  );
}

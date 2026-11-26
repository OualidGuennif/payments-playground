"use client";
// Spec: knowledge/components/ask-agent.md
// The console's shell: sign-in, then five tabs. Signed out is what the API says, never a guess.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleLab } from "./ConsoleLab";
import { ConsoleSessions } from "./ConsoleSessions";
import { ConsoleSettings } from "./ConsoleSettings";
import { consoleCall, type Overview, usd } from "./consoleApi";

const TABS = [
  ["overview", "Overview"],
  ["sessions", "Sessions"],
  ["settings", "Models and limits"],
  ["lab", "Test the agents"],
] as const;
type Tab = (typeof TABS)[number][0];

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const answer = await consoleCall("/login", { password });
    setBusy(false);
    setPassword("");
    if (answer.status === 200) onDone();
    else setError(answer.status === 429 ? "Too many tries. Wait 15 minutes." : answer.error);
  };
  return (
    <form onSubmit={submit} className="panel mx-auto max-w-sm space-y-4">
      <div className="space-y-1">
        <p className="eyebrow">Owner only</p>
        <h1 className="text-2xl">Atelier Velune console</h1>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Console password</span>
        <input
          type="password"
          autoComplete="current-password"
          className="field min-h-11"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button type="submit" className="btn w-full" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel space-y-1">
      <p className="eyebrow">{label}</p>
      <p className="font-serif text-3xl tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function OverviewTab() {
  const [view, setView] = useState<Overview>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    const answer = await consoleCall<Overview>("/overview");
    setView(answer.data);
    setError(answer.error);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!view) return <p className="text-sm text-muted">Loading…</p>;
  const refusals = Object.entries(view.refusals);
  return (
    <div className="space-y-6">
      <p className="text-sm">
        <span className={`pill ${view.available ? "border-ok text-ok" : "border-bad text-bad"}`}>
          {view.available
            ? "Assistant available"
            : "Assistant unavailable: no answer or guard model has a key"}
        </span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active sessions" value={String(view.activeSessions)} />
        <Stat
          label="Sessions today"
          value={String(view.sessionsToday)}
          note="Among the latest 200"
        />
        <Stat label="Messages today" value={String(view.messagesToday)} />
        <Stat
          label="Cost today"
          value={usd(view.costTodayUsd)}
          note={`Budget ${usd(view.dailyBudgetUsd)} a day (UTC)`}
        />
      </div>
      <meter
        className="h-2 w-full"
        min={0}
        max={view.dailyBudgetUsd}
        high={view.dailyBudgetUsd * 0.8}
        value={view.costTodayUsd}
        aria-label="Share of today's budget spent"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3">
          <h2 className="text-lg">Prompt cache by answer model</h2>
          {view.cacheByModel.length === 0 ? (
            <p className="text-sm text-muted">No model call today.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {view.cacheByModel.map((row) => (
                <li
                  key={row.model}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span className="font-mono text-xs">{row.model}</span>
                  <span className="tabular-nums">
                    {Math.round(row.hitRate * 100)}% read from cache ·{" "}
                    {row.inputTokens.toLocaleString()} input tokens
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Guard calls are counted with their message.</p>
        </section>
        <section className="panel space-y-3">
          <h2 className="text-lg">Refusals today by stage</h2>
          {refusals.length === 0 ? (
            <p className="text-sm text-muted">No refusal today.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {refusals.map(([stage, count]) => (
                <li key={stage} className="flex justify-between py-2">
                  <span className="capitalize">{stage}</span>
                  <span className="tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function ConsoleApp() {
  // undefined: not known yet; the first overview call says which.
  const [signedIn, setSignedIn] = useState<boolean>();
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    void consoleCall("/overview").then((answer) => setSignedIn(answer.status === 200));
  }, []);
  if (signedIn === undefined) return <p className="text-sm text-muted">Loading…</p>;
  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;
  const signOut = async () => {
    await consoleCall("/logout", {});
    setSignedIn(false);
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="eyebrow">Ask agent</p>
          <h1 className="text-3xl">Atelier Velune console</h1>
        </div>
        <button type="button" className="btn-ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
      <nav
        aria-label="Console"
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-2">
          {TABS.map(([id, label]) => (
            <li key={id}>
              <button
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
                className={
                  tab === id ? "btn min-h-10 px-4 py-1.5" : "btn-ghost min-h-10 px-4 py-1.5"
                }
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "overview" && <OverviewTab />}
      {tab === "sessions" && <ConsoleSessions />}
      {tab === "settings" && <ConsoleSettings />}
      {tab === "lab" && <ConsoleLab />}
    </div>
  );
}

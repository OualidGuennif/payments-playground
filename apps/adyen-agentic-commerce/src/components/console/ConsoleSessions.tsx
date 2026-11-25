"use client";
// Spec: knowledge/components/ask-agent.md
// Every session, then one session's full transcript with each message's verdicts, usage and cost.
import { useCallback, useEffect, useState } from "react";
import { consoleCall, type Message, type SessionSummary, usd, when } from "./consoleApi";
import { Verdicts } from "./Verdicts";

const FILTERS = [
  ["", "All"],
  ["active", "Active"],
  ["ended", "Ended"],
  ["locked", "Locked"],
] as const;

const tone = (state: SessionSummary["state"]) =>
  state === "active"
    ? "border-ok text-ok"
    : state === "locked"
      ? "border-bad text-bad"
      : "border-line text-muted";

function Transcript({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<{ session: SessionSummary; messages: Message[] }>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    const answer = await consoleCall<{ session: SessionSummary; messages: Message[] }>(
      `/sessions/${encodeURIComponent(id)}`,
    );
    setDetail(answer.data);
    setError(answer.error);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const close = async (action: "end" | "lock") => {
    const answer = await consoleCall(`/sessions/${encodeURIComponent(id)}/${action}`, {});
    if (answer.error) setError(answer.error);
    await load();
  };
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!detail) return <p className="text-sm text-muted">Loading…</p>;
  const s = detail.session;
  return (
    <div className="space-y-4">
      <button type="button" className="btn-ghost" onClick={onBack}>
        All sessions
      </button>
      <section className="panel space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-sm">{s.id}</h2>
          <span className={`pill ${tone(s.state)}`}>
            {s.state}
            {s.endReason ? `: ${s.endReason}` : ""}
          </span>
          {s.test && <span className="pill border-line text-muted">test</span>}
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted">Shopper</dt>
            <dd>
              {s.customer ?? "Guest"}
              {s.connected ? " · account connected" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Score</dt>
            <dd className="tabular-nums">{s.score} / 100</dd>
          </div>
          <div>
            <dt className="text-muted">Cost</dt>
            <dd className="tabular-nums">
              {usd(s.costUsd)} · {s.messages} message(s)
            </dd>
          </div>
          <div>
            <dt className="text-muted">Answer model</dt>
            <dd className="font-mono text-xs">
              {s.answer.model} · {s.answer.effort}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Guard model</dt>
            <dd className="font-mono text-xs">
              {s.guard.model} · {s.guard.effort}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Started, ends</dt>
            <dd className="tabular-nums">
              {when(s.createdAt)} → {when(s.endsAt)}
            </dd>
          </div>
        </dl>
        {s.state === "active" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => close("end")}>
              End session
            </button>
            <button type="button" className="btn-ghost text-bad" onClick={() => close("lock")}>
              Lock session
            </button>
          </div>
        )}
      </section>
      <ol className="space-y-3">
        {detail.messages.map((m) => (
          <li
            key={m.id}
            className={m.role === "note" ? "text-center text-xs text-muted" : "panel space-y-2"}
          >
            {m.role === "note" ? (
              <span>
                {m.text} · {when(m.at)}
              </span>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="eyebrow">
                    {m.role === "shopper"
                      ? `Shopper${m.via && m.via !== "text" ? ` (${m.via})` : ""}`
                      : "Assistant"}
                  </p>
                  <p className="text-xs text-muted tabular-nums">{when(m.at)}</p>
                </div>
                <p className="whitespace-pre-wrap text-sm">{m.text}</p>
                {m.widgets?.length ? (
                  <p className="text-xs text-muted">
                    Widgets:{" "}
                    {m.widgets.map((w) => w.resourceUri.replace("ui://widget/", "")).join(", ")}
                  </p>
                ) : null}
                <Verdicts verdicts={m.verdicts} />
                {m.usage && (
                  <p className="text-xs text-muted tabular-nums">
                    {m.usage.calls} model call(s) · {m.usage.input.toLocaleString()} input ·{" "}
                    {m.usage.cacheRead.toLocaleString()} from cache ·{" "}
                    {m.usage.output.toLocaleString()} output · {usd(m.costUsd)}
                  </p>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ConsoleSessions() {
  const [filter, setFilter] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();
  const load = useCallback(async () => {
    const answer = await consoleCall<{ sessions: SessionSummary[] }>(
      `/sessions${filter ? `?state=${filter}` : ""}`,
    );
    setSessions(answer.data?.sessions);
    setError(answer.error);
  }, [filter]);
  useEffect(() => {
    if (!open) void load();
  }, [load, open]);
  if (open) return <Transcript id={open} onBack={() => setOpen(undefined)} />;
  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap gap-2" aria-label="Filter sessions">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={
              filter === value ? "btn min-h-10 px-4 py-1.5" : "btn-ghost min-h-10 px-4 py-1.5"
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="btn-ghost min-h-10 px-4 py-1.5"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </fieldset>
      {error && <p className="text-sm text-bad">{error}</p>}
      {!sessions && !error && <p className="text-sm text-muted">Loading…</p>}
      {sessions?.length === 0 && <p className="text-sm text-muted">No session.</p>}
      <ul className="space-y-2">
        {sessions?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setOpen(s.id)}
              className="panel flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left hover:border-ink"
            >
              <span className={`pill ${tone(s.state)}`}>{s.state}</span>
              <span className="font-mono text-xs">{s.id}</span>
              {s.test && <span className="pill border-line text-muted">test</span>}
              <span className="text-sm">{s.customer ?? "Guest"}</span>
              <span className="ml-auto text-sm tabular-nums text-muted">
                {s.messages} msg · score {s.score} · {usd(s.costUsd)} · {when(s.lastAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

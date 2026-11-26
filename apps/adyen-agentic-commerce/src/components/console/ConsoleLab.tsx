"use client";
// Spec: knowledge/components/ask-agent.md
// The playground (the five stages on a test session, every verdict shown) and the red-team list
// (stages 1 to 3 on fixed attacks). Both call real models and count in the day's cost.
import { type FormEvent, useState } from "react";
import {
  consoleCall,
  type PlaygroundResult,
  type RedTeamResult,
  type StreamEvent,
  usd,
} from "./consoleApi";
import { Verdicts } from "./Verdicts";

type Turn = { text: string; result?: PlaygroundResult; error?: string };

function Steps({ events }: { events: StreamEvent[] }) {
  return (
    <ol className="flex flex-wrap gap-1.5 text-xs">
      {events
        .filter((e) => e.type !== "final")
        .map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: events of one answer never reorder.
          <li key={i} className="pill border-line text-muted">
            {e.type === "stage"
              ? `${e.stage}: ${e.result}`
              : e.type === "tool"
                ? `${e.name} ${e.phase}`
                : ""}
          </li>
        ))}
    </ol>
  );
}

function Playground() {
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const sent = text;
    setBusy(true);
    setText("");
    const answer = await consoleCall<PlaygroundResult>("/playground", { text: sent, sessionId });
    setBusy(false);
    if (answer.data) setSessionId(answer.data.sessionId);
    setTurns((all) => [...all, { text: sent, result: answer.data, error: answer.error }]);
  };
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">Playground</h2>
        <button
          type="button"
          className="btn-ghost min-h-10 px-4 py-1.5"
          onClick={() => {
            setSessionId(undefined);
            setTurns([]);
          }}
        >
          New test session
        </button>
      </div>
      <ol className="space-y-3">
        {turns.map((turn, i) => {
          const final = turn.result?.events.find((e) => e.type === "final");
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: turns are only appended.
            <li key={i} className="panel space-y-2">
              <p className="eyebrow">You</p>
              <p className="whitespace-pre-wrap text-sm">{turn.text}</p>
              {turn.error && <p className="text-sm text-bad">{turn.error}</p>}
              {turn.result?.refused && (
                <p className="text-sm text-bad">
                  Refused before any stage ran: {turn.result.refused}
                </p>
              )}
              {turn.result && <Steps events={turn.result.events} />}
              {final?.type === "final" && (
                <>
                  <p className="eyebrow">Assistant</p>
                  <p className="whitespace-pre-wrap text-sm">{final.text}</p>
                  {final.widgets.length > 0 && (
                    <p className="text-xs text-muted">
                      Widgets:{" "}
                      {final.widgets
                        .map((w) => w.resourceUri.replace("ui://widget/", ""))
                        .join(", ")}
                    </p>
                  )}
                  <p className="text-xs text-muted tabular-nums">
                    Mode {final.mode} · score {final.score} · {usd(turn.result?.last?.costUsd)}
                  </p>
                </>
              )}
              <Verdicts verdicts={turn.result?.last?.verdicts} />
            </li>
          );
        })}
      </ol>
      <form onSubmit={send} className="panel space-y-3">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Message, as a shopper would type it</span>
          <textarea
            className="field min-h-24"
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn" disabled={busy || !text.trim()}>
          {busy ? "Running the five stages…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function RedTeam() {
  const [run, setRun] = useState<RedTeamResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const answer = await consoleCall<RedTeamResult>("/redteam", {});
    setBusy(false);
    setRun(answer.data);
    setError(answer.error);
  };
  const passed = run?.results.filter((r) => r.pass).length ?? 0;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">Red team</h2>
        <button type="button" className="btn" onClick={start} disabled={busy}>
          {busy ? "Running…" : "Run the attack list"}
        </button>
      </div>
      <p className="text-sm text-muted">
        Ten fixed attacks through stages 1 to 3. Each passes when it is refused no later than the
        stage it names. Guard calls are billed and counted in today's cost.
      </p>
      {error && <p className="text-sm text-bad">{error}</p>}
      {run && (
        <>
          <p
            className={`pill ${passed === run.results.length ? "border-ok text-ok" : "border-bad text-bad"}`}
          >
            {passed} of {run.results.length} refused in time
          </p>
          <ul className="space-y-2">
            {run.results.map((r) => (
              <li key={r.kind} className="panel space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${r.pass ? "border-ok text-ok" : "border-bad text-bad"}`}>
                    {r.pass ? "pass" : "fail"}
                  </span>
                  <span className="text-sm font-medium">{r.kind}</span>
                  <span className="ml-auto text-xs text-muted tabular-nums">{usd(r.costUsd)}</span>
                </div>
                <p className="break-words font-mono text-xs">{r.text}</p>
                <p className="text-xs text-muted">
                  Expected at {r.expect};{" "}
                  {r.stage === "none" ? "let through" : `refused at ${r.stage}`} ({r.result})
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ConsoleLab() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Playground />
      <RedTeam />
    </div>
  );
}

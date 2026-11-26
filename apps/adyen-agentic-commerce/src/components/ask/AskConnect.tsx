"use client";
// Spec: knowledge/components/ask-agent.md
// Connecting the assistant to a signed-in shopper's account: the store's own device sign-in and
// consent screen, opened by the shopper; the token stays on the server, the panel only polls.
import { useEffect, useState } from "react";
import { askCall } from "./askClient";

type Start = { verificationUri: string; userCode: string; expiresIn: number };
type State = "none" | "pending" | "connected" | "denied" | "expired" | "other_customer";

const STOPPED: Partial<Record<State, string>> = {
  none: "The request was lost. Please try again.",
  denied: "You did not allow it. The assistant stays signed out.",
  expired: "The request expired. Please try again.",
  other_customer:
    "Another account approved it, so it was refused. Sign in with that account instead.",
};

export function AskConnect({ onConnected }: { onConnected: () => void }) {
  const [start, setStart] = useState<Start>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!start) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const until = Date.now() + start.expiresIn * 1000;
    const poll = async () => {
      if (!live) return;
      if (Date.now() > until) {
        setStart(undefined);
        setNote(STOPPED.expired);
        return;
      }
      const answer = await askCall<{ state: State }>("/connect");
      if (!live) return;
      const state = answer.data?.state;
      if (state === "connected") {
        setStart(undefined);
        onConnected();
        return;
      }
      const stopped = state ? STOPPED[state] : answer.message;
      if (stopped) {
        setStart(undefined);
        setNote(stopped);
        return;
      }
      timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [start, onConnected]);

  const begin = async () => {
    setBusy(true);
    setNote(undefined);
    const answer = await askCall<Start>("/connect", {});
    setBusy(false);
    if (answer.data) setStart(answer.data);
    else setNote(answer.message);
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-3.5 text-sm" aria-live="polite">
      {start ? (
        <div className="space-y-2.5">
          <p className="font-medium">Approve on the store&apos;s page</p>
          <p className="text-muted">
            Check the code <span className="code tabular-nums">{start.userCode}</span>, choose what
            the assistant may do and its budget, then come back here.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={start.verificationUri}
              target="_blank"
              rel="noopener"
              className="btn min-h-10 px-4 py-1.5"
            >
              Open the approval page
            </a>
            <button
              type="button"
              className="btn-ghost min-h-10 px-4 py-1.5"
              onClick={() => setStart(undefined)}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted" role="status">
            Waiting for your approval…
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1">
            <span className="block font-medium">Let the assistant pay for you</span>
            <span className="block text-xs text-muted">
              With a card saved in your account, within a budget you set.
            </span>
          </p>
          <button
            type="button"
            className="btn-ghost min-h-10 px-4 py-1.5"
            disabled={busy}
            onClick={() => void begin()}
          >
            {busy ? "Starting…" : "Connect"}
          </button>
          {note && <p className="w-full text-xs text-bad">{note}</p>}
        </div>
      )}
    </section>
  );
}

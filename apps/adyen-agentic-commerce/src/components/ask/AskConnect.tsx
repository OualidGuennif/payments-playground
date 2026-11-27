"use client";
// Spec: knowledge/components/ask-agent.md
// Connecting the assistant to a signed-in shopper's account: one click with a budget in the chat
// (the server approves its own device request for this shopper), or the store's device sign-in and
// consent screen; the token stays on the server either way.
import { useEffect, useState } from "react";
import { askCall } from "./askClient";

// EUR minor units, as the consent screen's presets.
const BUDGETS = [5000, 15000, 30000, 50000];
const euros = (minor: number) => `€${(minor / 100).toLocaleString("en-IE")}`;

type Start = { verificationUri: string; userCode: string; expiresIn: number };
type State = "none" | "pending" | "connected" | "denied" | "expired" | "other_customer";

const STOPPED: Partial<Record<State, string>> = {
  none: "The request was lost. Please try again.",
  denied: "You did not allow it. Your Personal Shopper stays signed out.",
  expired: "The request expired. Please try again.",
  other_customer:
    "Another account approved it, so it was refused. Sign in with that account instead.",
};

export function AskConnect({
  onConnected,
  onCancel,
}: {
  onConnected: () => void;
  // In the chat's budget overlay: the budget shows at once and Cancel closes the overlay.
  onCancel?: () => void;
}) {
  const [start, setStart] = useState<Start>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(onCancel !== undefined);
  const [budget, setBudget] = useState(15000);
  const [custom, setCustom] = useState("");

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

  const customMinor = custom.trim()
    ? Math.round(Number(custom.replace(",", ".")) * 100)
    : undefined;
  const chosen = customMinor ?? budget;
  const chosenValid = Number.isInteger(chosen) && chosen >= 100 && chosen <= 100_000;

  const allow = async () => {
    if (!chosenValid) {
      setNote("Pick a budget between €1 and €1,000.");
      return;
    }
    setBusy(true);
    setNote(undefined);
    const answer = await askCall<{ state: State }>("/connect/inline", { spendLimit: chosen });
    setBusy(false);
    const state = answer.data?.state;
    if (state === "connected") {
      setPicking(false);
      onConnected();
      return;
    }
    setNote((state && STOPPED[state]) ?? answer.message ?? STOPPED.expired);
  };

  const begin = async () => {
    setPicking(false);
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
              className="btn min-h-11 px-4 py-1.5"
            >
              Open the approval page
            </a>
            <button
              type="button"
              className="btn-ghost min-h-11 px-4 py-1.5"
              onClick={() => setStart(undefined)}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted" role="status">
            Waiting for your approval…
          </p>
        </div>
      ) : picking ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void allow();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="font-medium">Budget for the Personal Shopper</legend>
            <p className="text-xs text-muted">
              It pays only with a card saved in your account, after you confirm the total, and never
              beyond this amount.
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {BUDGETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  aria-pressed={!custom.trim() && budget === amount}
                  className="chip min-h-11 justify-center tabular-nums"
                  onClick={() => {
                    setBudget(amount);
                    setCustom("");
                  }}
                >
                  {euros(amount)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              Another amount (€)
              <input
                inputMode="decimal"
                className="field min-h-11 w-24 text-base sm:text-sm"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                aria-invalid={custom.trim() !== "" && !chosenValid}
              />
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn min-h-11 px-4 py-1.5" disabled={busy}>
              {busy ? "Allowing…" : `Allow up to ${chosenValid ? euros(chosen) : "…"}`}
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11 px-4 py-1.5"
              onClick={() => (onCancel ? onCancel() : setPicking(false))}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted">
            Change or revoke it any time on{" "}
            <a href="/account#agents" className="underline">
              your account
            </a>
            . Prefer the full consent screen?{" "}
            <button type="button" className="underline" onClick={() => void begin()}>
              Approve on the store&apos;s page
            </button>
            .
          </p>
          {note && <p className="text-xs text-bad">{note}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1">
            <span className="block font-medium">Let your Personal Shopper pay for you</span>
            <span className="block text-xs text-muted">
              With a card saved in your account, within a budget you set.
            </span>
          </p>
          <button
            type="button"
            className="btn-ghost min-h-11 px-4 py-1.5"
            disabled={busy}
            onClick={() => {
              setNote(undefined);
              setPicking(true);
            }}
          >
            Choose a budget
          </button>
          {note && <p className="w-full text-xs text-bad">{note}</p>}
        </div>
      )}
    </section>
  );
}

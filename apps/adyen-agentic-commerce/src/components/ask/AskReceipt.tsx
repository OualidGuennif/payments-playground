"use client";
// Spec: knowledge/components/ask-agent.md
// The receipt email for the bag's checkout, asked by the panel itself: the address goes to its own
// route and never through the assistant, so no model, transcript or prompt ever holds it.
import { type FormEvent, useState } from "react";
import { askCall } from "./askClient";
import { BAG_URI, type Fed } from "./askLogic";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_EMAIL = 254;

export function AskReceipt({
  checkoutId,
  accountEmail,
  onResult,
}: {
  checkoutId: string;
  accountEmail?: string;
  onResult: (fed: Fed) => void;
}) {
  const [typing, setTyping] = useState(!accountEmail);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const save = async (body: { email: string } | { account: true }) => {
    setBusy(true);
    setNote(undefined);
    const answer = await askCall<{ result: unknown }>("/checkout-email", { checkoutId, ...body });
    setBusy(false);
    const result = answer.data?.result;
    if (!record(result) || result.structuredContent === undefined) {
      setNote(answer.message ?? "The store could not take this email. Please try again.");
      return;
    }
    setEmail("");
    onResult({ resourceUri: BAG_URI, structuredContent: result.structuredContent, at: Date.now() });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = email.trim();
    if (typed) void save({ email: typed });
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-3.5 text-sm" aria-live="polite">
      <p className="font-medium">An email for your receipt</p>
      {typing ? (
        <form onSubmit={submit} className="mt-2.5 space-y-2.5">
          <label className="block text-xs text-muted" htmlFor="ask-receipt-email">
            The store sends the receipt there. The assistant never sees it.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="ask-receipt-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={MAX_EMAIL}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field min-h-10 min-w-0 flex-1"
              placeholder="you@example.com"
            />
            <button
              type="submit"
              className="btn min-h-10 px-4 py-1.5"
              disabled={busy || !email.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {accountEmail && (
              <button
                type="button"
                className="btn-ghost min-h-10 px-4 py-1.5"
                onClick={() => setTyping(false)}
              >
                Back
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          <p className="text-muted">
            Send the receipt to <span className="text-ink">{accountEmail}</span>?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn min-h-10 px-4 py-1.5"
              disabled={busy}
              onClick={() => void save({ account: true })}
            >
              {busy ? "Saving…" : "Use this email"}
            </button>
            <button
              type="button"
              className="btn-ghost min-h-10 px-4 py-1.5"
              disabled={busy}
              onClick={() => setTyping(true)}
            >
              Another email
            </button>
          </div>
        </div>
      )}
      {note && <p className="mt-2 text-xs text-bad">{note}</p>}
    </section>
  );
}

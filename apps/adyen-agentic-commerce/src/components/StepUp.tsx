// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { startAuthentication } from "@simplewebauthn/browser";
import { type FormEvent, useState } from "react";
import { type Answer, messageOf } from "@/lib/answer";
import { api } from "@/lib/client";

export type Confirm = { password: string } | { challengeId: string; response: unknown };

// Asks for the account password, or one of its passkeys, before a change a signed-in session alone
// may not make (owner, 2026-11-18). onConfirm sends the proof and answers an error to show, if any.
export function StepUp({
  prompt,
  hasPasskey,
  onConfirm,
  onCancel,
  bare = false,
}: {
  prompt: string;
  hasPasskey: boolean;
  // Inside an overlay card, which already frames it.
  bare?: boolean;
  onConfirm: (confirm: Confirm) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(proof: () => Promise<Confirm>) {
    setBusy(true);
    setError(undefined);
    try {
      setError(await onConfirm(await proof()));
    } catch (e) {
      // The browser's own cancel is not an error the shopper needs explained.
      if ((e as Error).name !== "NotAllowedError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function withPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    void run(async () => ({ password }));
  }

  const withPasskey = () =>
    run(async () => {
      const options = await api().account.confirm.options.post();
      const failed = messageOf(options as Answer, "Passkeys are unavailable right now.");
      if (failed) throw new Error(failed);
      const { challengeId, options: optionsJSON } = options.data as unknown as {
        challengeId: string;
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      };
      return { challengeId, response: await startAuthentication({ optionsJSON }) };
    });

  return (
    <form
      onSubmit={withPassword}
      className={bare ? "space-y-3" : "space-y-2 rounded-xl border border-accent p-3"}
      aria-label="Confirm it is you"
    >
      <p className="text-xs">{prompt} Confirm it is you.</p>
      <label className="block text-xs">
        <span className="block text-xs font-medium text-muted">Your password</span>
        <input
          data-autofocus
          type="password"
          name="password"
          autoComplete="current-password"
          className="field mt-1 min-h-11 w-full"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn px-3 py-1.5" disabled={busy}>
          Confirm
        </button>
        {hasPasskey ? (
          <button
            type="button"
            className="btn-ghost px-3 py-1.5"
            disabled={busy}
            onClick={withPasskey}
          >
            Use a passkey
          </button>
        ) : null}
        <button type="button" className="btn-ghost px-3 py-1.5" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import type { accountView } from "@/server/api";
import { api } from "@/lib/client";

type View = Awaited<ReturnType<typeof accountView>>;

const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function PasskeysPanel({
  passkeys,
  onChange,
}: {
  passkeys: View["passkeys"];
  onChange: (view: View) => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(undefined);
    try {
      const options = await api().passkeys.register.options.post();
      if (options.error) throw new Error("A passkey cannot be added right now.");
      const { challengeId, options: optionsJSON } = options.data as unknown as {
        challengeId: string;
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
      };
      const response = await startRegistration({ optionsJSON });
      const saved = await api().passkeys.register.verify.post({ challengeId, response });
      if (saved.error) throw new Error("The passkey could not be verified.");
      onChange(saved.data as unknown as View);
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const { data, error: failed } = await api().passkeys({ id }).delete();
    if (failed) setError("The passkey could not be removed.");
    else onChange(data as unknown as View);
  }

  return (
    <div className="panel space-y-4">
      <h2 className="text-xl">Passkeys</h2>
      <p className="text-sm text-muted">
        Sign in with your device's lock instead of a password. This site keeps only the public key.
      </p>
      {passkeys.length ? (
        <ul className="space-y-2">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm"
            >
              <span>
                Added {when(p.createdAt)}
                <span className="block text-xs text-muted">
                  {p.lastUsedAt ? `Last used ${when(p.lastUsedAt)}` : "Not used yet"}
                </span>
              </span>
              <button
                type="button"
                className="inline-flex min-h-11 cursor-pointer items-center px-2 text-xs underline"
                onClick={() => remove(p.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No passkey yet.</p>
      )}
      <button type="button" className="btn-ghost" disabled={busy} onClick={add}>
        Add a passkey
      </button>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

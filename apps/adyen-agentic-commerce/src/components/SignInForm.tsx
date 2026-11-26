// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { type Answer, messageOf } from "@/lib/answer";
import { api } from "@/lib/client";
import { rememberAccount, useKnownAccount } from "@/lib/known";
import { type SignIn, signInWithPasskey, signInWithPassword } from "@/lib/signIn";

export function SignInForm({ mode, next }: { mode: "sign-in" | "sign-up"; next: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const signUp = mode === "sign-up";
  const known = useKnownAccount();

  // A full navigation, so the next page's server render sees the new session cookie. The fragment
  // survived the redirect to this page (an agent's manage_url opens /account#agent-<id>).
  const done = () => {
    rememberAccount();
    window.location.assign(next.includes("#") ? next : next + location.hash);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setBusy(true);
    setError(undefined);
    if (signUp) {
      const answer = await api().customers.post({
        email,
        password,
        name: String(form.get("name") ?? ""),
      });
      const failed = messageOf(answer as Answer, "Something went wrong. Try again.");
      setBusy(false);
      if (failed) setError(failed);
      else done();
      return;
    }
    finish(await signInWithPassword(email, password));
  }

  function finish(result: SignIn) {
    setBusy(false);
    if (result.signedIn) done();
    else if (result.error) setError(result.error);
  }

  async function passkey() {
    setBusy(true);
    setError(undefined);
    finish(await signInWithPasskey());
  }

  const query = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="panel mx-auto max-w-md space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl">
          {signUp ? "Create your account" : known ? "Welcome back" : "Sign in"}
        </h1>
        <p className="text-sm text-muted">
          {signUp
            ? "Your account keeps your saved cards, your orders and the agents you connect."
            : known
              ? "Sign in again to pick up where you left off: your bag stays as it is."
              : "Sign in to see your account or to connect an agent."}
        </p>
      </div>
      {signUp && known ? (
        <p role="status" className="rounded-xl border border-line px-3.5 py-2.5 text-sm">
          This browser already has an account here.{" "}
          <Link
            href={`/sign-in?next=${encodeURIComponent(next)}`}
            className="font-medium underline"
          >
            Sign in instead
          </Link>
        </p>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        {signUp ? (
          <label className="block space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted">Name</span>
            <input name="name" autoComplete="name" maxLength={80} className="field" />
          </label>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="block text-xs font-medium text-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete={signUp ? "email" : "username webauthn"}
            className="field"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="block text-xs font-medium text-muted">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={signUp ? 12 : undefined}
            maxLength={128}
            autoComplete={signUp ? "new-password" : "current-password"}
            className="field"
          />
          {signUp ? <span className="block text-xs text-muted">12 to 128 characters.</span> : null}
        </label>
        <button type="submit" className="btn w-full" disabled={busy}>
          {signUp ? "Create account" : "Sign in"}
        </button>
      </form>
      {signUp ? null : (
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={passkey}>
          Sign in with a passkey
        </button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-muted">
        {signUp ? (
          <>
            Already have an account?{" "}
            <Link href={`/sign-in${query}`} className="underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href={`/sign-up${query}`} className="underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

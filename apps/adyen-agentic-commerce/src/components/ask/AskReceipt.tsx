"use client";
// Spec: knowledge/components/ask-agent.md
// The receipt email for the bag's checkout, asked by the panel itself: the address goes to its own
// route and never through the assistant, so no model, transcript or prompt ever holds it. A shopper
// with an account signs in here, without leaving the chat, and the account's email is used. The
// block never says whether an email has an account: the shopper chooses to sign in.
import { browserSupportsWebAuthnAutofill, WebAuthnAbortService } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { sessionChanged } from "@/components/AccountMenu";
import { knownAccount, rememberAccount } from "@/lib/known";
import { type SignIn, signInWithPasskey, signInWithPassword } from "@/lib/signIn";
import { askCall } from "./askClient";
import { BAG_URI, type Fed, receiptNeeded } from "./askLogic";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_EMAIL = 254;

type Step = "account" | "email" | "sign-in";

export function AskReceipt({
  checkoutId,
  accountEmail,
  onResult,
  onSignedIn,
}: {
  checkoutId: string;
  accountEmail?: string;
  onResult: (fed: Fed) => void;
  onSignedIn: () => void;
}) {
  const router = useRouter();
  // The block appears only in the browser, after a widget showed a checkout: the cookie is readable.
  // A browser that signed in here before opens on the sign-in.
  const [step, setStep] = useState<Step>(() =>
    accountEmail
      ? "account"
      : typeof document !== "undefined" && knownAccount()
        ? "sign-in"
        : "email",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const save = async (body: { email: string } | { account: true }) => {
    setBusy(true);
    setNote(undefined);
    const answer = await askCall<{ result: unknown }>("/checkout-email", { checkoutId, ...body });
    const result = answer.data?.result;
    if (!record(result) || result.structuredContent === undefined) {
      // A bag shown before a reload can be older than its checkout: one that has its email by now
      // only needs the widget to show it.
      const done = answer.error === "store_refused" && (await refreshed());
      setBusy(false);
      if (!done)
        setNote(answer.message ?? "The store could not take this email. Please try again.");
      return;
    }
    setBusy(false);
    setEmail("");
    onResult({ resourceUri: BAG_URI, structuredContent: result.structuredContent, at: Date.now() });
  };

  const refreshed = async () => {
    const fresh = await askCall<{ result: unknown }>("/widget", {
      name: "get_checkout",
      arguments: { id: checkoutId },
    });
    const result = fresh.data?.result;
    if (!record(result) || result.structuredContent === undefined) return false;
    const bag = { resourceUri: BAG_URI, structuredContent: result.structuredContent };
    if (receiptNeeded([bag]) === checkoutId) return false;
    onResult({ ...bag, at: Date.now() });
    return true;
  };

  // The panel and the page learn of a sign-in.
  const follow = () => {
    rememberAccount();
    onSignedIn();
    sessionChanged();
    router.refresh();
  };
  // The account's email is asked for once per block, whichever path asks first.
  const asked = useRef(false);
  // Signed in from this step: then the account's email goes on the checkout.
  const signedIn = async () => {
    follow();
    setPassword("");
    setStep("account");
    asked.current = true;
    await save({ account: true });
  };
  const latest = useRef({ signedIn, follow, save });
  useEffect(() => {
    latest.current = { signedIn, follow, save };
  });
  // The session view can arrive after the block, or the shopper signs in elsewhere: an account
  // known now wins over the sign-in or email step chosen when the block first drew.
  useEffect(() => {
    if (accountEmail && !asked.current) setStep("account");
  }, [accountEmail]);
  // Signed in, the account's email goes on the receipt without a question; the buttons show only
  // when that fails, or to choose another email.
  useEffect(() => {
    if (step !== "account" || !accountEmail || asked.current) return;
    asked.current = true;
    void latest.current.save({ account: true });
  }, [step, accountEmail]);

  const finish = (result: SignIn) => {
    setBusy(false);
    if (result.signedIn) void signedIn();
    else if (result.error) setNote(result.error);
  };

  // While the sign-in shows, the browser offers a saved passkey among the email field's own
  // suggestions; a password sign-in, the passkey button or leaving the step ends that offer.
  const prompting = useRef(false);
  useEffect(() => {
    if (step !== "sign-in") return;
    let live = true;
    void browserSupportsWebAuthnAutofill().then(async (offered) => {
      if (!offered || !live) return;
      const result = await signInWithPasskey(true, undefined, () => live && !prompting.current);
      if (!result.signedIn) return;
      // A passkey picked just before the step was left still signed in: the page follows the
      // session, and no email goes on the checkout without the shopper.
      if (live) void latest.current.signedIn();
      else latest.current.follow();
    });
    return () => {
      live = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [step]);

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const typed = email.trim();
    if (typed) void save({ email: typed });
  };

  const submitSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNote(undefined);
    finish(await signInWithPassword(email.trim(), password));
  };

  const passkey = async () => {
    setBusy(true);
    setNote(undefined);
    prompting.current = true;
    const result = await signInWithPasskey();
    prompting.current = false;
    finish(result);
  };

  const go = (next: Step) => {
    setNote(undefined);
    setStep(next);
  };

  return (
    <section className="p-3.5 text-sm" aria-live="polite">
      <p className="font-medium">
        {step === "sign-in" ? "Sign in for your receipt" : "An email for your receipt"}
      </p>
      {step === "account" && (
        <div className="mt-2 space-y-2.5">
          <p className="text-muted">
            {busy ? "Sending the receipt to " : "Send the receipt to "}
            <span className="text-ink">{accountEmail ?? "your account's email"}</span>
            {busy ? "…" : "?"}
          </p>
          <div className={busy ? "hidden" : "flex flex-wrap items-center gap-2"}>
            <button
              type="button"
              className="btn px-4 py-1.5"
              disabled={busy}
              onClick={() => void save({ account: true })}
            >
              {busy ? "Saving…" : "Use this email"}
            </button>
            <button
              type="button"
              className="btn-ghost px-4 py-1.5"
              disabled={busy}
              onClick={() => go("email")}
            >
              Another email
            </button>
          </div>
        </div>
      )}
      {step === "email" && (
        <form onSubmit={submitEmail} className="mt-2 space-y-2.5">
          <label className="block text-xs text-muted" htmlFor="ask-receipt-email">
            The store sends the receipt there. Your Personal Shopper never sees it.
          </label>
          <div className="flex items-center gap-2">
            <input
              id="ask-receipt-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={MAX_EMAIL}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field min-h-11 min-w-0 flex-1"
              placeholder="you@example.com"
            />
            <button
              type="submit"
              className="btn shrink-0 px-4 py-1.5"
              disabled={busy || !email.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          <button
            type="button"
            className="min-h-11 text-left text-sm font-medium underline underline-offset-4"
            onClick={() => go(accountEmail ? "account" : "sign-in")}
          >
            {accountEmail ? "Back to your account's email" : "I have an account"}
          </button>
        </form>
      )}
      {step === "sign-in" && (
        <form onSubmit={(e) => void submitSignIn(e)} className="mt-2 space-y-2.5">
          <p className="text-xs text-muted">
            Your account&apos;s email then goes on the receipt, without leaving the chat.
          </p>
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-muted">Email</span>
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username webauthn"
              maxLength={MAX_EMAIL}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field min-h-11"
            />
          </label>
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-muted">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field min-h-11"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn px-4 py-1.5" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="btn-ghost px-4 py-1.5"
              disabled={busy}
              onClick={() => void passkey()}
            >
              Use a passkey
            </button>
          </div>
          <button
            type="button"
            className="min-h-11 text-left text-sm font-medium underline underline-offset-4 disabled:opacity-40"
            disabled={busy}
            onClick={() => go("email")}
          >
            Type an email instead
          </button>
        </form>
      )}
      {note && (
        <p role="alert" className="mt-2 text-xs text-bad">
          {note}
        </p>
      )}
    </section>
  );
}

// Spec: knowledge/components/agentic-storefront.md
"use client";
// "Add your email address" (ADR-020): one field, then sign in, a new account with the welcome
// offer, or Pay as guest. On /checkout it calls the store's own routes; over the Personal Shopper
// the Ask routes, so the conversation keeps its checkout. The email never reaches the assistant.
import { type FormEvent, type ReactNode, useState } from "react";
import { sessionChanged } from "@/components/AccountMenu";
import { ChatOverlayModal } from "@/components/ChatOverlayModal";
import { askCall } from "@/components/ask/askClient";
import { type Answer, codeOf, messageOf } from "@/lib/answer";
import { api } from "@/lib/client";
import { rememberAccount } from "@/lib/known";
import { money } from "@/lib/money";
import { seasonFor } from "@/lib/seasons";
import { type SignIn, signInWithPasskey, signInWithPassword } from "@/lib/signIn";
import { checkEmail, MAX_EMAIL, welcomeSaving } from "./payIdentity";

export type PaySource = "checkout" | "ask";
/** The store's answer once the checkout has its email: a checkout view, or an Ask tool result. */
export type PayResolved = { data: unknown; account: boolean };

type Step = "email" | "returning" | "new" | "limited";
type Outcome = { data: unknown } | { problem: string };

const CLAIM_FAILED = "The store could not take this checkout. Try again.";
const EMAIL_FAILED = "The store could not take this email. Try again.";

// The store's browser routes answer { error: words, code }.
function wordsOf(error: { value: unknown } | null | undefined, fallback: string): string {
  const value = error?.value as { error?: unknown } | undefined;
  return typeof value?.error === "string" ? value.error : fallback;
}

async function claim(source: PaySource, checkoutId: string): Promise<Outcome> {
  if (source === "ask") {
    const answer = await askCall<unknown>("/checkout-claim", {
      checkoutId,
      applyWelcomeOffer: true,
    });
    return answer.data ? { data: answer.data } : { problem: answer.message ?? CLAIM_FAILED };
  }
  const { data, error } = await api()
    .checkouts({ id: checkoutId })
    .claim.post({ applyWelcomeOffer: true });
  if (error || !data || "error" in data) return { problem: wordsOf(error, CLAIM_FAILED) };
  return { data };
}

async function guestEmail(source: PaySource, checkoutId: string, email: string): Promise<Outcome> {
  if (source === "ask") {
    const answer = await askCall<unknown>("/checkout-email", { checkoutId, email });
    return answer.data ? { data: answer.data } : { problem: answer.message ?? EMAIL_FAILED };
  }
  const { data, error } = await api().checkouts({ id: checkoutId }).email.post({ email });
  if (error || !data || "error" in data) return { problem: wordsOf(error, EMAIL_FAILED) };
  return { data };
}

export function PayIdentityModal({
  checkoutId,
  source,
  subtotal,
  total,
  onClose,
  onResolved,
}: {
  checkoutId: string;
  source: PaySource;
  subtotal: number;
  total: number;
  onClose: () => void;
  onResolved: (resolved: PayResolved) => void;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const season = seasonFor();
  const saving = welcomeSaving(subtotal);
  // Over the Personal Shopper the buttons say the shopper stays in the chat (ADR-021).
  const inChat = source === "ask";

  const go = (next: Step) => {
    setProblem(undefined);
    setPassword("");
    setStep(next);
  };

  const settle = (outcome: Outcome, account: boolean) => {
    setBusy(false);
    if ("problem" in outcome) setProblem(outcome.problem);
    else onResolved({ data: outcome.data, account });
  };

  // Signed in here: the header and the Personal Shopper learn it, then the checkout becomes the
  // account's, with the welcome offer asked for (the store grants it to a first order only).
  const claimForAccount = async () => {
    rememberAccount();
    sessionChanged();
    settle(await claim(source, checkoutId), true);
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    const next = await checkEmail(email);
    setBusy(false);
    if (next.step === "email") setProblem(next.problem);
    else go(next.step);
  };

  const finishSignIn = async (result: SignIn) => {
    if (result.signedIn) return claimForAccount();
    setBusy(false);
    if (result.error) setProblem(result.error);
  };
  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    await finishSignIn(await signInWithPassword(email.trim(), password));
  };
  const passkey = async () => {
    setBusy(true);
    setProblem(undefined);
    await finishSignIn(await signInWithPasskey());
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    const answer = (await api().customers.post({
      email: email.trim(),
      password,
      name: name.trim(),
    })) as Answer;
    if (!answer.error) return claimForAccount();
    setBusy(false);
    if (codeOf(answer) === "email_taken") {
      go("returning");
      setProblem("An account already uses this email. Sign in to continue.");
      return;
    }
    setProblem(messageOf(answer, "Something went wrong. Try again."));
  };

  const payAsGuest = async () => {
    setBusy(true);
    setProblem(undefined);
    settle(await guestEmail(source, checkoutId, email.trim()), false);
  };

  const changeEmail = (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="min-w-0 break-all font-medium">{email.trim()}</span>
      <button
        type="button"
        className="cursor-pointer text-muted underline"
        disabled={busy}
        onClick={() => go("email")}
      >
        Change
      </button>
    </p>
  );
  const guestButton = (label: string) => (
    <button
      type="button"
      className="btn-ghost w-full"
      disabled={busy}
      onClick={() => void payAsGuest()}
    >
      {label}
    </button>
  );

  let title: string;
  let body: ReactNode;
  if (step === "email") {
    title = "Add your email address";
    body = (
      <form onSubmit={(event) => void submitEmail(event)} noValidate className="space-y-4">
        <p className="text-sm text-muted">
          For your receipt. If it has an account here, you can sign in; if not, you can create one
          or pay as a guest.
        </p>
        <label className="block space-y-1 text-sm">
          <span className="block text-xs font-medium text-muted">Email</span>
          <input
            data-autofocus
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            maxLength={MAX_EMAIL}
            required
            aria-invalid={problem ? true : undefined}
            className="field min-h-11 text-base sm:text-sm"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (problem) setProblem(undefined);
            }}
          />
        </label>
        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    );
  } else if (step === "returning") {
    title = "Welcome back";
    body = (
      <div className="space-y-4">
        {changeEmail}
        <form onSubmit={(event) => void submitPassword(event)} className="space-y-3">
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email.trim()}
            readOnly
            hidden
          />
          <label className="block space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted">Password</span>
            <input
              data-autofocus
              type="password"
              name="password"
              autoComplete="current-password"
              maxLength={128}
              required
              className="field min-h-11 text-base sm:text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" className="btn w-full" disabled={busy || !password}>
            {busy
              ? "Signing in…"
              : inChat
                ? "Sign in & return to chat"
                : "Sign in & continue to payment"}
          </button>
        </form>
        <button
          type="button"
          className="btn-ghost w-full"
          disabled={busy}
          onClick={() => void passkey()}
        >
          Use a passkey
        </button>
        <button
          type="button"
          className="w-full cursor-pointer text-center text-sm text-muted underline disabled:opacity-40"
          disabled={busy}
          onClick={() => void payAsGuest()}
        >
          Continue as guest instead
        </button>
      </div>
    );
  } else if (step === "new") {
    title = "Create an account & get 5% off";
    body = (
      <div className="space-y-4">
        {changeEmail}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
          <img
            src={season.giftImage}
            alt=""
            width={48}
            height={60}
            className="aspect-[4/5] w-12 shrink-0 rounded-lg border border-line object-cover"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-medium">First order: 5% off and the {season.giftTitle}, free</p>
            <p className="text-ok">
              You save {money(saving)}.{" "}
              <span className="text-ink">
                New total <span className="font-medium tabular-nums">{money(total - saving)}</span>
              </span>{" "}
              <s className="text-muted tabular-nums">{money(total)}</s>
            </p>
          </div>
        </div>
        <form onSubmit={(event) => void createAccount(event)} className="space-y-3">
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email.trim()}
            readOnly
            hidden
          />
          <label className="block space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted">Name (optional)</span>
            <input
              data-autofocus
              name="name"
              autoComplete="name"
              maxLength={80}
              className="field min-h-11 text-base sm:text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted">Password</span>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              className="field min-h-11 text-base sm:text-sm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span className="block text-xs text-muted">12 to 128 characters.</span>
          </label>
          <button type="submit" className="btn w-full" disabled={busy || password.length < 12}>
            {busy
              ? "Creating your account…"
              : inChat
                ? "Create account & apply 5% off"
                : "Create account & continue"}
          </button>
        </form>
        <p className="text-center text-xs text-muted">or</p>
        {guestButton(`Pay as guest · ${money(total)}`)}
      </div>
    );
  } else {
    title = "Too many checks right now";
    body = (
      <div className="space-y-4">
        {changeEmail}
        <p className="text-sm text-muted">
          The store is taking a short break from checking emails. Pay as a guest with this email, or
          sign in if it has an account.
        </p>
        <button
          type="button"
          data-autofocus
          className="btn w-full"
          disabled={busy}
          onClick={() => go("returning")}
        >
          Sign in
        </button>
        {guestButton(`Pay as guest · ${money(total)}`)}
      </div>
    );
  }

  return (
    <ChatOverlayModal title={title} onClose={onClose} busy={busy} focusKey={step}>
      {body}
      {problem ? (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      ) : null}
      <p className="text-xs text-muted">Adyen TEST: no real money moves.</p>
    </ChatOverlayModal>
  );
}

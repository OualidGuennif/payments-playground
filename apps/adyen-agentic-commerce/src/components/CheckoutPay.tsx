// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { checkoutView } from "@/server/api";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { StatusPill } from "@/components/StatusPill";
import { api, BAG_EVENT, type BagChange } from "@/lib/client";
import { signInHere, useKnownAccount } from "@/lib/known";
import { money } from "@/lib/money";
import { shopperWords } from "@/lib/shopper-words";

type View = ReturnType<typeof checkoutView>;

const UPDATED = "Your bag was updated, here or in the chat. Check the new total, then pay.";
const NOTICE_KEY = "velune-checkout-notice";
function reloadWith(why?: string) {
  try {
    if (why) sessionStorage.setItem(NOTICE_KEY, why);
  } catch {
    /* private mode: reload without the notice */
  }
  window.location.reload();
}
const linesKey = (lines: { variantId: string; quantity: number }[]) =>
  lines.map((l) => `${l.variantId}×${l.quantity}`).join(",");

export function CheckoutPay({
  initial,
  clientKey,
  redirect,
}: {
  initial: View;
  clientKey?: string;
  redirect?: { sessionId: string; redirectResult: string };
}) {
  const [view, setView] = useState(initial);
  const [pendingRedirect, setPendingRedirect] = useState(redirect);
  const [error, setError] = useState<string>();

  const createSession = useCallback(async (): Promise<SessionInfo> => {
    const { data, error } = await api().checkouts({ id: view.id }).session.post();
    if (error || !data || "error" in data) throw new Error("The payment form could not be loaded.");
    return data as SessionInfo;
  }, [view.id]);

  const [notice, setNotice] = useState<string>();
  // A notice carried over the reload that gave Drop-in its new session.
  useEffect(() => {
    try {
      const carried = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
      if (carried) setNotice(carried);
    } catch {
      /* private mode: no notice to carry */
    }
  }, []);
  // Set once this page's own payment is under way: nothing may remount the form until it ends.
  const [payingHere, setPayingHere] = useState(false);
  const shown = useRef(view);
  // A view whose lines or total moved reloads the page: Drop-in's session was priced from the old
  // bag, and a second AdyenCheckout instance on one page leaves its Pay button dead.
  const show = useCallback((next: View, why?: string) => {
    const before = shown.current;
    shown.current = next;
    if (before.total !== next.total || linesKey(before.lines) !== linesKey(next.lines)) {
      reloadWith(why);
      return;
    }
    setView(next);
  }, []);
  const refresh = useCallback(
    async (why?: string) => {
      const { data } = await api().checkouts({ id: view.id }).get();
      if (data && !("error" in data)) show(data, why);
    },
    [view.id, show],
  );

  // The page follows the checkout while it can still change or is being paid elsewhere: every 4 s
  // while visible, and at once when the Ask panel says the bag changed.
  const live = view.phase === "open" || view.phase === "complete_in_progress";
  useEffect(() => {
    if (!live || payingHere || pendingRedirect) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(UPDATED);
    }, 4_000);
    return () => clearInterval(timer);
  }, [live, payingHere, pendingRedirect, refresh]);

  useEffect(() => {
    const onBag = (event: Event) => {
      const change = (event as CustomEvent<BagChange>).detail;
      const current = shown.current;
      if (!change || payingHere) return;
      if (change.checkoutId === current.id) {
        void refresh(UPDATED);
        return;
      }
      // A checkout made on the site takes the shopper's one bag; an agent's follows its agent.
      if (current.channel !== "web" || current.phase !== "open" || change.paid) return;
      if (!change.lines.length || linesKey(change.lines) === linesKey(current.lines)) return;
      void api()
        .checkouts({ id: current.id })
        .lines.post({ lines: change.lines })
        .then(({ data }) => {
          if (data && !("error" in data)) show(data, UPDATED);
        });
    };
    window.addEventListener(BAG_EVENT, onBag);
    return () => window.removeEventListener(BAG_EVENT, onBag);
  }, [payingHere, refresh, show]);

  // The checkout is held for this form's payment before Drop-in sends it: a payment already
  // running (another tab, or the assistant in the chat) or a bag changed since the form opened
  // stops it here, in words.
  const beforePay = useCallback(
    async (sessionId: string) => {
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["pay-intent"].post({ sessionId });
      if (!error && data && !("error" in data)) {
        setPayingHere(true);
        setNotice(undefined);
        return undefined;
      }
      const code = (error?.value as { code?: unknown } | undefined)?.code;
      if (code === "checkout_changed") {
        const why =
          "Your bag changed while the payment form was open. Check the new total, then pay.";
        reloadWith(why);
        return why;
      }
      return shopperWords(code === "payment_in_progress" ? code : "payment_unavailable");
    },
    [view.id],
  );

  const onFinished = useCallback(
    async (sessionId: string, sessionResult: string) => {
      if (window.location.search) window.history.replaceState(null, "", `/checkout/${view.id}`);
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["session-result"].post({ sessionId, sessionResult });
      setPendingRedirect(undefined);
      setPayingHere(false);
      if (error || !data || "error" in data) {
        setError("Adyen has not confirmed the payment yet. Refresh in a moment.");
        return;
      }
      show(data);
    },
    [view.id, show],
  );

  const [email, setEmail] = useState(initial.accountEmail ?? "");
  const known = useKnownAccount();
  const [savingEmail, setSavingEmail] = useState(false);
  // A checkout an agent handed over as a guest may lack only the receipt's email: ask for it here.
  const needsEmailOnly =
    view.phase === "open" &&
    view.status === "incomplete" &&
    view.messages.length > 0 &&
    view.messages.every((m) => m.code === "missing_buyer_email");

  const saveEmail = async (event: FormEvent) => {
    event.preventDefault();
    setSavingEmail(true);
    const { data, error } = await api().checkouts({ id: view.id }).email.post({ email });
    setSavingEmail(false);
    if (error || !data || "error" in data) {
      const value = error?.value as { error?: unknown } | undefined;
      setError(typeof value?.error === "string" ? value.error : shopperWords("invalid_email"));
      return;
    }
    setError(undefined);
    show(data);
  };

  const payable =
    view.phase === "open" &&
    view.status !== "incomplete" &&
    view.status !== "canceled" &&
    view.status !== "complete_in_progress" &&
    view.paymentsReady;
  // Back from a 3-D Secure redirect, the form finishes its own payment even though it holds the
  // checkout.
  const showForm =
    view.phase === "open" && view.paymentsReady && (payable || pendingRedirect || payingHere);
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl">Checkout</h1>
          <StatusPill status={view.status} />
        </div>
        {view.agentName && view.phase === "open" ? (
          <p className="panel text-sm">
            <strong>{view.agentName}</strong> prepared this checkout for you. Review it and pay
            below, or close this page to decline.
          </p>
        ) : null}
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
          {view.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local SVG drawings need no optimiser */}
              <img
                src={`/api/art/${l.variantId}.svg`}
                alt=""
                width={48}
                height={48}
                className="size-12 rounded-lg border border-line"
              />
              <span className="flex-1">
                {l.title} <span className="text-muted">× {l.quantity}</span>
              </span>
              <span className="tabular-nums">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="panel space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{money(view.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd className="tabular-nums">{view.fulfillment ? money(view.fulfillment) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(view.total)}</dd>
          </div>
        </dl>
        {view.messages.map((m) => (
          <p key={m.code} className="text-sm text-warn">
            {m.content}
          </p>
        ))}
      </section>
      <section className="panel space-y-4">
        {view.order ? (
          <div className="space-y-3">
            <h2 className="text-2xl">Thank you, your order is in.</h2>
            <p className="text-sm text-muted">
              Payment {view.order.status}. Adyen reference{" "}
              <span className="code">{view.order.pspReference ?? "pending"}</span>
            </p>
            <Link href={`/orders/${view.order.id}`} className="btn">
              View the order
            </Link>
          </div>
        ) : view.phase === "complete_in_progress" ? (
          <p className="text-sm">
            Adyen is still processing this payment. The order appears as soon as Adyen confirms it.
          </p>
        ) : showForm ? (
          <DropinPanel
            beforePay={beforePay}
            label="Pay on Adyen TEST"
            clientKey={clientKey}
            createSession={createSession}
            onFinished={onFinished}
            redirect={pendingRedirect}
          />
        ) : needsEmailOnly && view.paymentsReady ? (
          <form onSubmit={saveEmail} className="space-y-3">
            <h2 className="text-xl">Where should we send the receipt?</h2>
            {known && !view.signedIn ? (
              <p className="text-sm">
                Welcome back.{" "}
                <a href={signInHere()} className="font-medium underline">
                  Sign in
                </a>{" "}
                to use your account&apos;s email, or type one below.
              </p>
            ) : null}
            <label htmlFor="checkout-email" className="block text-sm text-muted">
              Email
            </label>
            <input
              id="checkout-email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              className="field w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn w-full" disabled={!email.trim() || savingEmail}>
              {savingEmail ? "Saving…" : "Continue to payment"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted">
            {!view.paymentsReady
              ? "Payments are switched off on this server."
              : view.status === "complete_in_progress"
                ? shopperWords("payment_in_progress")
                : view.status === "canceled"
                  ? shopperWords("checkout_canceled")
                  : shopperWords("checkout_not_payable")}
          </p>
        )}
        {notice ? (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

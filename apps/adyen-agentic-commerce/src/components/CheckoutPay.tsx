// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { type FormEvent, useCallback, useState } from "react";
import type { checkoutView } from "@/server/api";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { StatusPill } from "@/components/StatusPill";
import { api } from "@/lib/client";
import { money } from "@/lib/money";

type View = ReturnType<typeof checkoutView>;

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

  const [formKey, setFormKey] = useState(0);
  const refresh = useCallback(async () => {
    const { data } = await api().checkouts({ id: view.id }).get();
    if (data && !("error" in data)) setView(data);
  }, [view.id]);

  // The checkout is held for this form's payment before Drop-in sends it: a payment already
  // running (another tab, or the assistant in the chat) or a bag changed since the form opened
  // stops it here, in words.
  const beforePay = useCallback(
    async (sessionId: string) => {
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["pay-intent"].post({ sessionId });
      if (!error && data && !("error" in data)) return undefined;
      const code = (error?.value as { code?: unknown } | undefined)?.code;
      if (code === "checkout_changed") {
        const notice =
          "Your bag changed while the payment form was open. Check the new total, then pay.";
        await refresh();
        setError(notice);
        setFormKey((k) => k + 1);
        return notice;
      }
      if (code === "payment_in_progress")
        return "A payment for this bag is already in progress, here or in the chat. This page updates when it ends.";
      return "The payment could not start. Try again in a moment.";
    },
    [view.id, refresh],
  );

  const onFinished = useCallback(
    async (sessionId: string, sessionResult: string) => {
      if (window.location.search) window.history.replaceState(null, "", `/checkout/${view.id}`);
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["session-result"].post({ sessionId, sessionResult });
      setPendingRedirect(undefined);
      if (error || !data || "error" in data) {
        setError("Adyen has not confirmed the payment yet. Refresh in a moment.");
        return;
      }
      setView(data);
    },
    [view.id],
  );

  const [email, setEmail] = useState("");
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
      setError(typeof value?.error === "string" ? value.error : "The email could not be saved.");
      return;
    }
    setError(undefined);
    setView(data);
  };

  const payable =
    view.phase === "open" &&
    view.status !== "incomplete" &&
    view.status !== "canceled" &&
    view.status !== "complete_in_progress" &&
    view.paymentsReady;
  // Back from a 3-D Secure redirect, the form finishes its own payment even though it holds the
  // checkout.
  const showForm = view.phase === "open" && view.paymentsReady && (payable || pendingRedirect);
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
            key={formKey}
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
                ? "A payment for this bag is already in progress, in another tab or in the chat. This page updates when it ends."
                : view.status === "canceled"
                  ? "This checkout was canceled."
                  : "This checkout is missing details, so it can't be paid yet."}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

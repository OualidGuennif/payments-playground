// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
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
  const [error, setError] = useState<string>();

  const createSession = useCallback(async (): Promise<SessionInfo> => {
    const { data, error } = await api().checkouts({ id: view.id }).session.post();
    if (error || !data || "error" in data) throw new Error("The payment form could not be loaded.");
    return data as SessionInfo;
  }, [view.id]);

  const onFinished = useCallback(
    async (sessionId: string, sessionResult: string) => {
      if (window.location.search) window.history.replaceState(null, "", `/checkout/${view.id}`);
      const { data, error } = await api()
        .checkouts({ id: view.id })
        ["session-result"].post({ sessionId, sessionResult });
      if (error || !data || "error" in data) {
        setError("Adyen has not confirmed the payment yet. Refresh in a moment.");
        return;
      }
      setView(data);
    },
    [view.id],
  );

  const payable =
    view.phase === "open" &&
    view.status !== "incomplete" &&
    view.status !== "canceled" &&
    view.paymentsReady;
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
        ) : payable ? (
          <DropinPanel
            label="Pay on Adyen TEST"
            clientKey={clientKey}
            createSession={createSession}
            onFinished={onFinished}
            redirect={redirect}
          />
        ) : (
          <p className="text-sm text-muted">
            {!view.paymentsReady
              ? "Payments are switched off on this server."
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

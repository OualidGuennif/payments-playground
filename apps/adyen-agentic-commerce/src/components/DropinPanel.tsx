// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useEffect, useRef, useState } from "react";
import "@adyen/adyen-web/styles/adyen.css";

export type SessionInfo = {
  id: string;
  sessionData: string;
  clientKey: string;
  amount: number;
  currency: string;
  // False when the payer is not the checkout's own signed-in customer: no saved card to offer.
  storedCards?: boolean;
};

type Props = {
  // Creates the Adyen session on the server; amount and reference are decided there.
  createSession: () => Promise<SessionInfo>;
  onFinished: (sessionId: string, sessionResult: string) => Promise<void>;
  clientKey?: string;
  // Set when Adyen redirected back to this page.
  redirect?: { sessionId: string; redirectResult: string };
  label?: string;
  // A card save offers only a new card; a purchase may reuse a saved one.
  storedMethods?: boolean;
};

export function DropinPanel({
  createSession,
  onFinished,
  clientKey,
  redirect,
  label,
  storedMethods = true,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let unmount: (() => void) | undefined;
    (async () => {
      try {
        const { AdyenCheckout, Dropin } = await import("@adyen/adyen-web/auto");
        if (!active) return;
        const finish = async (
          sessionId: string,
          result?: { sessionResult?: string; resultCode?: string },
        ) => {
          if (!active) return;
          if (!result?.sessionResult) {
            setError(
              result?.resultCode
                ? `The payment did not go through (${result.resultCode}). Try another card.`
                : "The payment did not go through. Try again.",
            );
            setState("error");
            return;
          }
          setState("done");
          await onFinished(sessionId, result.sessionResult);
        };
        if (redirect) {
          const key = clientKey || (await createSession()).clientKey;
          if (!active) return;
          if (!key?.startsWith("test_")) throw new Error("Only a TEST client key is accepted");
          const checkout = await AdyenCheckout({
            environment: "test",
            clientKey: key,
            session: { id: redirect.sessionId },
            countryCode: "FR",
            locale: "en-US",
            onPaymentCompleted: (data) =>
              finish(redirect.sessionId, data as { sessionResult?: string; resultCode?: string }),
            onPaymentFailed: (data) =>
              finish(redirect.sessionId, data as { sessionResult?: string; resultCode?: string }),
            onError: (e) => {
              if (!active || e.name === "CANCEL") return;
              setError(e.message);
              setState("error");
            },
          });
          if (!active) return;
          checkout.submitDetails({ details: { redirectResult: redirect.redirectResult } });
          return;
        }
        const session = await createSession();
        if (!active) return;
        if (!session.clientKey?.startsWith("test_"))
          throw new Error("Only a TEST client key is accepted");
        const checkout = await AdyenCheckout({
          environment: "test",
          clientKey: session.clientKey,
          session: { id: session.id, sessionData: session.sessionData },
          amount: { value: session.amount, currency: session.currency },
          countryCode: "FR",
          locale: "en-US",
          onPaymentCompleted: (data) =>
            finish(session.id, data as { sessionResult?: string; resultCode?: string }),
          onPaymentFailed: (data) =>
            finish(session.id, data as { sessionResult?: string; resultCode?: string }),
          onError: (e) => {
            if (!active || e.name === "CANCEL") return;
            setError(e.message);
            setState("error");
          },
        });
        if (!active || !host.current) return;
        const showStored = storedMethods && session.storedCards !== false;
        const dropin = new Dropin(checkout, { showStoredPaymentMethods: showStored }).mount(
          host.current,
        );
        unmount = () => {
          try {
            dropin.unmount();
          } catch {
            // Ignore teardown errors if Drop-in already completed or unmounted itself.
          }
        };
        setState("ready");
      } catch (e) {
        if (!active) return;
        setError((e as Error).message);
        setState("error");
      }
    })();
    return () => {
      active = false;
      unmount?.();
    };
  }, [clientKey, createSession, onFinished, redirect, storedMethods]);

  return (
    <div className="space-y-3">
      {label ? <p className="eyebrow">{label}</p> : null}
      {state === "loading" ? (
        <p className="text-sm text-muted">Loading the secure payment form…</p>
      ) : null}
      {state === "done" ? <p className="text-sm text-muted">Confirming with Adyen…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div ref={host} className={state === "ready" ? "dropin-surface" : undefined} />
    </div>
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useEffect, useRef, useState } from "react";
import "@adyen/adyen-web/styles/adyen.css";
import { onThemeChange, resolvedTheme, type Theme } from "@/lib/theme";

// The card fields live in Adyen's frames, out of reach of the page's CSS: they take the store's
// colour tokens as computed when Drop-in mounts (a theme switch mounts it again), so the frames
// follow globals.css and no colour is written twice.
function fieldStyles(): Record<string, Record<string, string>> {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const ink = token("--color-ink");
  return {
    base: { color: ink, caretColor: ink, background: token("--color-card"), fontSize: "16px" },
    placeholder: { color: token("--color-muted") },
    error: { color: token("--color-bad") },
    validated: { color: ink },
  };
}

// Apple Pay and Google Pay above the list, in the store's ink: black on light, white on dark,
// with round ends like the store's buttons (Apple Pay's comes from globals.css).
// The card brands come from the session (allowedPaymentMethods), so the card names none here.
// autoFocus, keypadFix and disableIOSArrowKeys keep the secured fields usable on iOS Safari
// (owner, 2026-11-27).
function dropinOptions(theme: Theme) {
  const wallet: "white" | "black" = theme === "dark" ? "white" : "black";
  const styles = fieldStyles();
  return {
    // A session lists saved cards only for the signed-in owner's shopper reference.
    showStoredPaymentMethods: true,
    instantPaymentTypes: ["applepay", "googlepay"] as ("applepay" | "googlepay")[],
    paymentMethodsConfiguration: {
      // The cardholder's name is asked for first, optional (owner, 2026-11-27).
      card: {
        hasHolderName: true,
        positionHolderNameOnTop: true,
        autoFocus: true,
        keypadFix: true,
        disableIOSArrowKeys: true,
        styles,
      },
      storedCard: { keypadFix: true, disableIOSArrowKeys: true, styles },
      applepay: { buttonType: "buy" as const, buttonColor: wallet },
      googlepay: {
        buttonType: "buy" as const,
        buttonColor: wallet,
        buttonRadius: 24,
        buttonSizeMode: "fill" as const,
      },
      paypal: { style: { color: wallet, shape: "pill" as const } },
    },
  };
}

export type SessionInfo = {
  id: string;
  sessionData: string;
  clientKey: string;
  amount: number;
  currency: string;
};

type Props = {
  // Creates the Adyen session on the server; amount and reference are decided there.
  createSession: () => Promise<SessionInfo>;
  onFinished: (sessionId: string, sessionResult: string) => Promise<void>;
  clientKey?: string;
  // Set when Adyen redirected back to this page.
  redirect?: { sessionId: string; redirectResult: string };
  label?: string;
  // Asked before Drop-in sends the payment: a sentence stops it (another payment holds the
  // checkout, or the bag changed since the form opened), nothing lets it go.
  beforePay?: (sessionId: string) => Promise<string | undefined>;
};

export function DropinPanel({
  createSession,
  onFinished,
  clientKey,
  redirect,
  label,
  beforePay,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [error, setError] = useState<string>();
  // Mounts Drop-in again in the given theme, on the same Adyen checkout and session.
  const remount = useRef<(theme: Theme) => void>(undefined);
  // From the moment a payment is sent until Adyen answers, Drop-in may be showing 3-D Secure:
  // a theme switch then waits rather than unmount it.
  const paying = useRef(false);

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
          paying.current = false;
          // Adyen has answered: the session is spent or Drop-in shows its final state, so a theme
          // switch from here on keeps what is shown rather than mount a fresh form on it.
          remount.current = undefined;
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
          // Only resolves or rejects: the payment data goes to Adyen as Drop-in built it, never here.
          beforeSubmit: async (state, _component, actions) => {
            paying.current = true;
            const refusal = beforePay ? await beforePay(session.id) : undefined;
            if (!active || refusal) paying.current = false;
            if (!active) return actions.reject();
            if (refusal) {
              setError(refusal);
              return actions.reject();
            }
            setError(undefined);
            actions.resolve(state);
          },
          onPaymentCompleted: (data) =>
            finish(session.id, data as { sessionResult?: string; resultCode?: string }),
          onPaymentFailed: (data) =>
            finish(session.id, data as { sessionResult?: string; resultCode?: string }),
          onError: (e) => {
            paying.current = false;
            if (!active || e.name === "CANCEL") return;
            remount.current = undefined;
            setError(e.message);
            setState("error");
          },
        });
        if (!active || !host.current) return;
        const target = host.current;
        let shown: Theme = resolvedTheme();
        let dropin = new Dropin(checkout, dropinOptions(shown)).mount(target);
        const drop = () => {
          try {
            dropin.unmount();
          } catch {
            // Ignore teardown errors if Drop-in already completed or unmounted itself.
          }
        };
        remount.current = (theme) => {
          if (!active || theme === shown || paying.current) return;
          drop();
          shown = theme;
          dropin = new Dropin(checkout, dropinOptions(theme)).mount(target);
        };
        unmount = () => {
          remount.current = undefined;
          drop();
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
  }, [beforePay, clientKey, createSession, onFinished, redirect]);

  // The header's theme switch: the card fields and wallet buttons cannot follow by CSS alone.
  useEffect(() => onThemeChange(() => remount.current?.(resolvedTheme())), []);

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

"use client";
import { apiClient, formatMinorAmount, unwrap } from "@suite/ui/client.ts";
import type { App } from "@/server/api";
import { useEffect, useState } from "react";
import { completeSessionRedirect } from "../../checkout/session-redirect.ts";
import { type PaymentOutcome, ResultCard } from "./ResultCard.tsx";

interface Attempt {
  state: string;
  pspReference?: string;
  paymentMethod?: string;
}

interface OrderDetail {
  order: { id: string; flow: string; amount: { value: number; currency: string } };
  attempts: Attempt[];
}

interface RedirectResponse {
  result: Record<string, unknown>;
}

// The attempt state a webhook or an earlier return already stored, worded as
// the resultCode the shopper would have seen.
const RESULT_CODE: Record<string, string> = {
  authorised: "Authorised",
  refused: "Refused",
  pending: "Pending",
  cancelled: "Cancelled",
  error: "Error",
};

/** Where "New payment" goes: the flow and integration this order came from. */
function flowHref(flow: string): string {
  const [name, integration] = flow.split("-");
  if (name === "sessions" || name === "advanced") {
    return `/${name}?integration=${integration === "component" ? "component" : "dropin"}`;
  }
  if (flow === "api-only-pci") return "/api-only";
  if (flow === "pay-by-link" || flow === "mit") return `/${flow}`;
  return "/";
}

function outcomeFromAttempts(attempts: Attempt[]): PaymentOutcome | null {
  const last = attempts.findLast((attempt) => attempt.state !== "created");
  if (!last) return null;
  return {
    resultCode: RESULT_CODE[last.state],
    pspReference: last.pspReference,
    method: last.paymentMethod,
  };
}

// A Sessions return leaves no attempt on this server until its webhook arrives, so a reload
// (the URL no longer names the redirect) would show the order's previous attempt, perhaps an
// older refusal. The tab keeps Adyen Web's answer with the number of settled attempts it saw;
// a settled attempt stored after that is newer and wins.
const KEPT_ANSWER = "digital:session-redirect-answer";

interface KeptAnswer {
  orderId: string;
  outcome: PaymentOutcome;
  settled: number;
}

function settledCount(attempts: Attempt[]): number {
  return attempts.filter((attempt) => attempt.state !== "created").length;
}

function keepSessionAnswer(orderId: string, outcome: PaymentOutcome, attempts: Attempt[]) {
  const kept: KeptAnswer = { orderId, outcome, settled: settledCount(attempts) };
  try {
    sessionStorage.setItem(KEPT_ANSWER, JSON.stringify(kept));
  } catch {
    // Storage refused: a reload falls back to the order's attempts.
  }
}

function keptSessionAnswer(orderId: string, attempts: Attempt[]): PaymentOutcome | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEPT_ANSWER) ?? "null") as KeptAnswer | null;
    if (kept?.orderId !== orderId || typeof kept.settled !== "number" || !kept.outcome) {
      return null;
    }
    return settledCount(attempts) > kept.settled ? null : kept.outcome;
  } catch {
    return null;
  }
}

/** Pending and Received wait for the webhook; anything else is an answer to show. */
function isFinal(outcome: PaymentOutcome | null): boolean {
  return !!outcome && outcome.resultCode !== "Pending" && outcome.resultCode !== "Received";
}

function outcomeFrom(result: Record<string, unknown> | undefined): PaymentOutcome {
  const paymentMethod = result?.paymentMethod as { type?: string; brand?: string } | undefined;
  return {
    resultCode: result?.resultCode as string | undefined,
    pspReference: result?.pspReference as string | undefined,
    method: paymentMethod?.brand ?? paymentMethod?.type,
  };
}

export default function RedirectReturn(props: {
  orderId: string;
  redirectResult: string | null;
  sessionId: string | null;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const order = apiClient<App>().api.digital.orders({ id: props.orderId });

    // Without a redirectResult (Pay by Link, or a reload once it was used)
    // only a webhook can finish the order, so the page polls for it briefly.
    async function poll(remaining: number) {
      const next = unwrap(await order.get()) as OrderDetail;
      if (stopped) return;
      setDetail(next);
      const shown =
        keptSessionAnswer(props.orderId, next.attempts) ?? outcomeFromAttempts(next.attempts);
      setOutcome(shown ?? { resultCode: "Pending" });
      if (!isFinal(shown) && remaining > 0) {
        timer = setTimeout(() => poll(remaining - 1), 3000);
      }
    }

    // The redirectResult is single-use: a reload should read the stored
    // outcome rather than submit it again.
    function forgetRedirect() {
      const url = new URL(globalThis.location.href);
      url.searchParams.delete("redirectResult");
      url.searchParams.delete("sessionId");
      history.replaceState(null, "", url);
    }

    async function run() {
      try {
        if (props.redirectResult && props.sessionId) {
          // Sessions (ADR-023): Adyen Web submits the redirectResult through the
          // session; this server never calls /payments/details for it, and the
          // order follows the AUTHORISATION webhook.
          const next = unwrap(await order.get()) as OrderDetail;
          if (stopped) return;
          setDetail(next);
          if (!next.order.flow.startsWith("sessions")) {
            throw new Error("This return names a session, but the order is not a Sessions order.");
          }
          const bootstrap = unwrap(await apiClient<App>().api.bootstrap.get()) as {
            clientKey?: string;
          };
          if (stopped) return;
          if (!bootstrap.clientKey) throw new Error("A valid TEST client key is required.");
          // Nothing was submitted until here, so a failed check above leaves the redirect in
          // the URL for a reload to try again; from here on it is spent.
          forgetRedirect();
          // Until Adyen Web answers, a reload knows nothing of this payment: it shows
          // Pending and waits for a newer settled attempt, never the older one.
          keepSessionAnswer(props.orderId, { resultCode: "Pending" }, next.attempts);
          const { result } = await completeSessionRedirect({
            clientKey: bootstrap.clientKey,
            sessionId: props.sessionId,
            redirectResult: props.redirectResult,
          });
          const answered = outcomeFrom(result as Record<string, unknown>);
          keepSessionAnswer(props.orderId, answered, next.attempts);
          if (stopped) return;
          setOutcome(answered);
          // Pending or Received: only the webhook settles it, so wait for it as a reload would.
          if (!isFinal(answered)) timer = setTimeout(() => poll(10), 3000);
        } else if (props.redirectResult) {
          // Advanced: the server submits it to /payments/details and settles the attempt.
          const response = unwrap(
            await order["redirect-result"].post({ redirectResult: props.redirectResult }),
          ) as RedirectResponse;
          forgetRedirect();
          setOutcome(outcomeFrom(response.result));
          const next = unwrap(await order.get()) as OrderDetail;
          if (!stopped) setDetail(next);
        } else {
          await poll(10);
        }
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [props.orderId, props.redirectResult, props.sessionId]);

  if (error) {
    return (
      <div className="return-card">
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
        <a className="button button--secondary" href={`/back-office?orderId=${props.orderId}`}>
          Open in Back Office
        </a>
      </div>
    );
  }

  if (!outcome || !detail) {
    return (
      <div className="return-card return-card--loading" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>Confirming your payment…</p>
      </div>
    );
  }

  const amount = detail.order.amount;
  return (
    <div className="return-card">
      <ResultCard
        outcome={outcome}
        amountText={formatMinorAmount(amount.value, amount.currency)}
        orderId={detail.order.id}
        restartHref={flowHref(detail.order.flow)}
      />
    </div>
  );
}

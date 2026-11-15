"use client";
import { apiClient, formatMinorAmount, unwrap } from "@suite/ui/client.ts";
import type { App } from "@/server/api";
import { useEffect, useState } from "react";
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

export default function RedirectReturn(
  props: { orderId: string; redirectResult: string | null },
) {
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
      const fromAttempts = outcomeFromAttempts(next.attempts);
      setOutcome(fromAttempts ?? { resultCode: "Pending" });
      const settled = fromAttempts && fromAttempts.resultCode !== "Pending";
      if (!settled && remaining > 0) {
        timer = setTimeout(() => poll(remaining - 1), 3000);
      }
    }

    async function run() {
      try {
        if (props.redirectResult) {
          const response = unwrap(
            await order["redirect-result"].post({ redirectResult: props.redirectResult }),
          ) as RedirectResponse;
          // The redirectResult is single-use: a reload should read the stored
          // outcome rather than submit it again.
          const url = new URL(globalThis.location.href);
          url.searchParams.delete("redirectResult");
          url.searchParams.delete("sessionId");
          history.replaceState(null, "", url);
          const paymentMethod = response.result.paymentMethod as
            | { type?: string; brand?: string }
            | undefined;
          setOutcome({
            resultCode: response.result.resultCode as string | undefined,
            pspReference: response.result.pspReference as string | undefined,
            method: paymentMethod?.brand ?? paymentMethod?.type,
          });
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
  }, [props.orderId, props.redirectResult]);

  if (error) {
    return (
      <div className="return-card">
        <div className="notice notice--danger" role="alert">{error}</div>
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

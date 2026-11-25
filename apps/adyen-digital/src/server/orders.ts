// Spec: knowledge/components/adyen-digital.md
// Recording every Adyen call and deriving an order's state from Adyen's answers.
import { ledgerOf, reconcile } from "@suite/platform/modifications.ts";
import {
  actionPermissions,
  capabilitiesFor,
  lifecycleSourceAttempt,
} from "@suite/platform/lifecycle.ts";
import {
  mapAdyenResultCode,
  type OrderResolution,
  type OrderResolutionInput,
  resolveOrder,
} from "@suite/platform/state-machine.ts";
import type { AttemptAggregate, OrderAggregate } from "@suite/platform/types.ts";
import { context } from "./context.ts";
import { resultField, responseStatus } from "./input.ts";

export async function recordedCall<T>(input: {
  correlationId: string;
  name: string;
  method?: string;
  endpoint: string;
  request: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  const started = performance.now();
  try {
    const response = await input.execute();
    context.repository.recordApiCall({
      appId: "digital",
      correlationId: input.correlationId,
      name: input.name,
      method: input.method ?? "POST",
      endpoint: input.endpoint,
      status: 200,
      durationMs: Math.round(performance.now() - started),
      request: input.request,
      response,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Adyen API request failed.";
    context.repository.recordApiCall({
      appId: "digital",
      correlationId: input.correlationId,
      name: input.name,
      method: input.method ?? "POST",
      endpoint: input.endpoint,
      status: responseStatus(error),
      durationMs: Math.round(performance.now() - started),
      request: input.request,
      response: {},
      error: message,
    });
    throw error;
  }
}

/** Re-derives the order from its attempts (plus any terminal event) and stores it. */
export function resolveAndStore(
  order: OrderAggregate,
  events: Pick<
    OrderResolutionInput,
    "expiresAt" | "linkStatus" | "orderClosedWebhook" | "modificationWebhook"
  > = {},
): OrderResolution {
  const resolution = resolveOrder({
    currentState: order.state,
    totalValue: order.amount.value,
    expiresAt: order.expiresAt,
    ...events,
    attempts: context.repository.listAttempts(order.id).map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      value: attempt.amount.value,
      pspReference: attempt.pspReference,
    })),
  });
  context.repository.updateOrder(order.id, {
    state: resolution.state,
    paidValue: resolution.paidValue,
  });
  return resolution;
}

/**
 * Writes one Adyen payment result onto its attempt and re-resolves the order.
 * /payments, /payments/details and MIT all end here, so a 3DS or redirect
 * outcome reaches the Back Office the same way a frictionless one does.
 */
export function settleAttempt(
  order: OrderAggregate,
  attempt: AttemptAggregate,
  result: unknown,
): OrderResolution {
  const state = mapAdyenResultCode(String(resultField(result, "resultCode") ?? ""));
  const updated = context.repository.updateAttempt(attempt.id, {
    state,
    pspReference: String(resultField(result, "pspReference") ?? "") || undefined,
    refusalReason: String(resultField(result, "refusalReason") ?? "") || undefined,
  });
  if (state === "authorised") {
    context.repository.recordPaymentPart({
      orderId: order.id,
      attemptId: attempt.id,
      pspReference: updated.pspReference,
      amount: updated.amount,
      state: "authorised",
    });
  }
  return resolveAndStore(order);
}

// What a stored attempt state reads as for a shopper, when /result is reloaded.
export const RESULT_CODE_FOR_STATE: Record<string, string> = {
  authorised: "Authorised",
  refused: "Refused",
  pending: "Pending",
  cancelled: "Cancelled",
  error: "Error",
};

/**
 * What was captured, refunded and cancelled on the order's authorised
 * payment, and what can be done next. The totals come from HMAC-valid
 * webhooks; a request Adyen answered "received" is pending until its own
 * webhook arrives.
 */
export function lifecycleFor(order: OrderAggregate, attempts: AttemptAggregate[]) {
  const source = lifecycleSourceAttempt(attempts);
  const paymentMethod = (source ?? attempts.find((attempt) => attempt.paymentMethod))
    ?.paymentMethod;
  const modifications = reconcile(
    context.repository.listActions(order.id),
    context.repository.modificationEvents(order.id),
  );
  const settled = ledgerOf(source?.amount.value ?? 0, modifications);
  // A method captured on authorisation never sees a CAPTURE webhook: what is
  // authorised is captured.
  const ledger =
    capabilitiesFor(paymentMethod).automaticCapture && !settled.cancelled
      ? { ...settled, captured: settled.authorised }
      : settled;
  return {
    ledger,
    modifications,
    capabilities: capabilitiesFor(paymentMethod),
    permissions: actionPermissions(order.state, paymentMethod, ledger),
  };
}

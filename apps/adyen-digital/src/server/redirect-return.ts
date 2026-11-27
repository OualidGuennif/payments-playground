// Spec: knowledge/components/adyen-digital.md
// A redirect return is a reload only when this exact redirectResult was already submitted: an
// order can hold older settled attempts (five refusals before its session was renewed) that say
// nothing about the payment the shopper is coming back from.
import type { AttemptAggregate, TimelineEntry } from "@suite/platform/types.ts";

type Answer = Record<string, unknown>;

function record(value: unknown): Answer | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Answer)
    : undefined;
}

/** Adyen's answer to an earlier /payments/details call with this redirectResult, if one succeeded. */
export function earlierRedirectAnswer(
  timeline: TimelineEntry[],
  redirectResult: string,
): Answer | undefined {
  for (const entry of timeline) {
    if (entry.kind !== "api_call" || entry.name !== "Checkout API /payments/details") continue;
    if (entry.status !== "200") continue;
    const payload = record(entry.payload);
    const details = record(record(payload?.request)?.details);
    if (details?.redirectResult === redirectResult) return record(payload?.response);
  }
  return undefined;
}

/**
 * What a reload shows: the stored state of the attempt that answer settled, which a webhook may
 * have moved on since (Pending, then Authorised), else the answer itself.
 */
export function reloadedResult(
  answer: Answer,
  attempts: AttemptAggregate[],
  codeForState: Record<string, string>,
): Answer {
  const pspReference = typeof answer.pspReference === "string" ? answer.pspReference : undefined;
  const attempt = pspReference
    ? attempts.findLast((item) => item.pspReference === pspReference)
    : undefined;
  const resultCode = attempt ? codeForState[attempt.state] : undefined;
  if (!attempt || !resultCode) return answer;
  return {
    resultCode,
    pspReference,
    paymentMethod: { type: attempt.paymentMethod },
  };
}

/**
 * The attempt a redirect answer settles: the one /payments left waiting, else the one a webhook
 * already stored for that PSP reference, else none (the caller creates it).
 */
export function attemptForRedirect(
  attempts: AttemptAggregate[],
  pspReference: unknown,
): AttemptAggregate | undefined {
  const waiting = attempts.findLast((item) => item.state === "pending" || item.state === "created");
  if (waiting) return waiting;
  if (typeof pspReference !== "string" || !pspReference) return undefined;
  return attempts.findLast((item) => item.pspReference === pspReference);
}

// Spec: knowledge/components/adyen-digital.md
// The browser asks for a new session on the same order and waits; the server decides (ADR-022).

/** The server's answer while Adyen's refusal webhooks for the session are not all in. */
export interface RenewalWait {
  waiting: true;
  refusals: number;
  limit: number;
}

/**
 * What the result card's one button does after a failed payment: try again in the same session,
 * ask the server for a new session on the same order, or start a new checkout (a new order).
 */
export type RetryMode = "same" | "renew" | "new";

/** The server answered 409: this order takes no new session, only a new checkout can pay. */
export class RenewalRefused extends Error {}

/**
 * Only a payment Adyen refused counts toward the five a session takes: an error, a cancellation
 * or a closed session (14_0422) is not a refusal.
 */
export function countsAsRefusal(failure: unknown): boolean {
  return (failure as { resultCode?: unknown } | null)?.resultCode === "Refused";
}

export function retryModeFor(input: {
  flow: string;
  /** The session or its order expired (its expiry passed, or Adyen answered 14_0423). */
  expired: boolean;
  /** The server refused a renewal (409): the order is paid, pending, part paid or expired. */
  renewalRefused: boolean;
  /** onPaymentFailed results with resultCode "Refused" in this session. */
  refusals: number;
  /** Adyen closed the session (14_0422) before five refusals were counted here. */
  closed: boolean;
  limit: number;
}): RetryMode {
  if (input.flow !== "sessions") return "same";
  if (input.expired || input.renewalRefused) return "new";
  // The count only says when to ask; the server decides from Adyen's webhooks (ADR-022).
  if (input.refusals >= input.limit || input.closed) return "renew";
  return "same";
}

export const RENEWAL_POLL_MS = 2_000;
export const RENEWAL_TIMEOUT_MS = 60_000;

function isWait(answer: unknown): answer is RenewalWait {
  return (answer as Partial<RenewalWait> | null)?.waiting === true;
}

export function renewalTimeoutMessage(wait: RenewalWait): string {
  return `After 60 s Adyen had confirmed ${wait.refusals} of ${wait.limit} refusals for this session, so the server opened no new one. Refusal webhooks reach only a public URL: locally they need a tunnel or a replay.`;
}

/**
 * Asks every 2 s until the server answers with a session, refuses (`ask` throws its reason) or
 * 60 s pass, which ends in an error and never in a session. Null when a newer run took over.
 */
export async function pollRenewal<T>(input: {
  ask: () => Promise<T | RenewalWait>;
  onWait: (wait: RenewalWait) => void;
  stale: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<T | null> {
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const deadline = now() + RENEWAL_TIMEOUT_MS;
  for (;;) {
    const answer = await input.ask();
    if (input.stale()) return null;
    if (!isWait(answer)) return answer;
    input.onWait(answer);
    if (now() + RENEWAL_POLL_MS > deadline) throw new Error(renewalTimeoutMessage(answer));
    await sleep(RENEWAL_POLL_MS);
    if (input.stale()) return null;
  }
}

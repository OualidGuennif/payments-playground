// Spec: knowledge/components/adyen-digital.md
// The browser asks for a new session on the same order and waits; the server decides (ADR-022).

/** The server's answer while Adyen's refusal webhooks for the session are not all in. */
export interface RenewalWait {
  waiting: true;
  refusals: number;
  limit: number;
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

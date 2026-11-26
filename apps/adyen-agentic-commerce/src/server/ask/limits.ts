// Spec: knowledge/components/ask-agent.md
// Fixed-window counters for the Ask agent's per-address limits (new sessions per hour, messages
// per minute, password tries per 15 minutes). In memory, per process, like the store's other limits.

const TRACKED_MAX = 10_000;

export type Limiter = {
  // Counts one more hit; returns the seconds to wait when the hit is over the limit.
  hit(key: string, now?: number): number | undefined;
  // Seconds to wait without counting, for a check made before the outcome is known.
  blocked(key: string, now?: number): number | undefined;
  forget(): void;
};

export function windowLimiter(windowMs: number, max: number): Limiter {
  const windows = new Map<string, { start: number; count: number }>();
  const wait = (start: number, now: number) =>
    Math.max(1, Math.ceil((start + windowMs - now) / 1000));
  return {
    hit(key, now = Date.now()) {
      const entry = windows.get(key);
      if (!entry || now - entry.start >= windowMs) {
        if (!entry && windows.size >= TRACKED_MAX) {
          for (const [k, e] of windows) if (now - e.start >= windowMs) windows.delete(k);
          if (windows.size >= TRACKED_MAX) windows.delete(windows.keys().next().value!);
        }
        windows.set(key, { start: now, count: 1 });
        return max >= 1 ? undefined : wait(now, now);
      }
      entry.count += 1;
      return entry.count > max ? wait(entry.start, now) : undefined;
    },
    blocked(key, now = Date.now()) {
      const entry = windows.get(key);
      if (!entry || now - entry.start >= windowMs || entry.count < max) return undefined;
      return wait(entry.start, now);
    },
    forget: () => windows.clear(),
  };
}

export const newSessions = windowLimiter(60 * 60_000, 6);
export const messagesPerMinute = windowLimiter(60_000, 10);
// Failed password tries only: a right password never counts.
export const consoleFailures = windowLimiter(15 * 60_000, 5);
export const voiceFailures = windowLimiter(15 * 60_000, 5);

export function forgetAskLimits(): void {
  for (const limiter of [newSessions, messagesPerMinute, consoleFailures, voiceFailures])
    limiter.forget();
}

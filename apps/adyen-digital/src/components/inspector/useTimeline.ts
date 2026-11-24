// Spec: knowledge/components/adyen-digital.md
import { unwrap } from "@suite/ui/client.ts";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import { api } from "../../checkout/client.ts";
import type { TimelineEntry } from "./Timeline.tsx";

/**
 * Polls what the server recorded (API calls, webhooks) for every correlation id
 * of the run while the inspector is open, merged into one list.
 */
export function useTimelinePolling(
  correlationIds: string[],
  inspectorOpen: boolean,
  setTimeline: Dispatch<SetStateAction<TimelineEntry[]>>,
) {
  const polledCorrelations = correlationIds.join("|");
  useEffect(() => {
    if (!polledCorrelations || !inspectorOpen) return;
    let active = true;
    const refresh = async () => {
      try {
        const responses = await Promise.all(
          polledCorrelations.split("|").map((id) =>
            api()
              .api.timeline({ correlationId: id })
              .get()
              .then((result) => unwrap(result) as { entries: TimelineEntry[] })
              .catch(() => ({ entries: [] as TimelineEntry[] })),
          ),
        );
        if (!active) return;
        const merged = new Map<string, TimelineEntry>();
        for (const response of responses) {
          for (const entry of response.entries) merged.set(entry.id, entry);
        }
        setTimeline([...merged.values()]);
      } catch {
        // Inspector polling is best-effort and must not interrupt checkout.
      }
    };
    refresh();
    const interval = globalThis.setInterval(refresh, 2500);
    return () => {
      active = false;
      globalThis.clearInterval(interval);
    };
  }, [polledCorrelations, inspectorOpen, setTimeline]);
}

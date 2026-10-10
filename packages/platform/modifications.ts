import type {
  Ledger,
  Modification,
  ModificationEvent,
  ModificationKind,
  ModificationRequest,
} from "./types.ts";

/** The modification each webhook event reports on. */
const EVENT_KIND: Record<string, ModificationKind> = {
  CAPTURE: "capture",
  CAPTURE_FAILED: "capture",
  CANCELLATION: "cancel",
  REFUND: "refund",
  REFUND_FAILED: "refund",
  REFUNDED_REVERSED: "refund",
};

export function isModificationEvent(eventCode: string): boolean {
  return eventCode in EVENT_KIND;
}

/**
 * The outcome one event gives a modification. CAPTURE and REFUND carry
 * success; CAPTURE_FAILED and REFUND_FAILED overturn an earlier success days
 * later, and REFUNDED_REVERSED returns refunded funds to the merchant.
 */
function outcome(event: ModificationEvent): Modification["status"] {
  if (event.eventCode === "REFUNDED_REVERSED") return "reversed";
  if (event.eventCode.endsWith("_FAILED")) return "failed";
  return event.success ? "succeeded" : "failed";
}

/** Later events win: a CAPTURE_FAILED after a CAPTURE success is the result. */
function settle(modification: Modification, events: ModificationEvent[]): Modification {
  const ordered = [...events].sort((left, right) =>
    left.receivedAt.localeCompare(right.receivedAt)
  );
  const last = ordered.at(-1);
  if (!last) return modification;
  return {
    ...modification,
    status: outcome(last),
    reason: last.reason ?? modification.reason,
    value: modification.value ?? ordered.find((event) => event.value !== undefined)?.value,
    settledAt: last.receivedAt,
  };
}

/**
 * Every capture, cancel and refund of a payment with its outcome. A request
 * this playground sent is matched to its webhooks by the modification's PSP
 * reference, which Adyen returns with "received". Rows recorded before that
 * reference was kept are matched to the first unclaimed event of their kind
 * that arrived after them. Events nothing here asked for (a capture in the
 * Customer Area) become modifications of their own, so the totals stay true.
 */
export function reconcile(
  requests: ModificationRequest[],
  events: ModificationEvent[],
): Modification[] {
  const claimed = new Set<ModificationEvent>();
  const byReference = new Map<string, ModificationEvent[]>();
  for (const event of events) {
    if (!event.pspReference) continue;
    byReference.set(event.pspReference, [...(byReference.get(event.pspReference) ?? []), event]);
  }

  const modifications: Modification[] = [];
  for (const request of requests) {
    const base: Modification = {
      kind: request.kind,
      status: request.state === "rejected" ? "rejected" : "pending",
      value: request.value,
      pspReference: request.pspReference,
      reason: request.reason,
      idempotencyKey: request.idempotencyKey,
      requestedAt: request.createdAt,
      external: false,
    };
    if (request.state === "rejected") {
      modifications.push(base);
      continue;
    }
    let matched = request.pspReference
      ? (byReference.get(request.pspReference) ?? []).filter((event) =>
        EVENT_KIND[event.eventCode] === request.kind
      )
      : [];
    if (!request.pspReference) {
      const legacy = events.find((event) =>
        !claimed.has(event) && EVENT_KIND[event.eventCode] === request.kind &&
        event.receivedAt >= request.createdAt
      );
      matched = legacy
        ? events.filter((event) =>
          event.pspReference === legacy.pspReference &&
          EVENT_KIND[event.eventCode] === request.kind
        )
        : [];
    }
    for (const event of matched) claimed.add(event);
    modifications.push(settle(base, matched));
  }

  const external = new Map<string, ModificationEvent[]>();
  for (const event of events) {
    if (claimed.has(event)) continue;
    const key = `${EVENT_KIND[event.eventCode]}:${event.pspReference ?? event.receivedAt}`;
    external.set(key, [...(external.get(key) ?? []), event]);
  }
  for (const group of external.values()) {
    modifications.push(settle({
      kind: EVENT_KIND[group[0].eventCode],
      status: "pending",
      pspReference: group[0].pspReference,
      external: true,
    }, group));
  }

  return modifications.sort((left, right) =>
    (left.requestedAt ?? left.settledAt ?? "").localeCompare(
      right.requestedAt ?? right.settledAt ?? "",
    )
  );
}

/**
 * Totals in minor units. A modification without an amount (a full cancel,
 * or an old full capture recorded without one) counts as what was left.
 */
export function ledgerOf(authorised: number, modifications: Modification[]): Ledger {
  const ledger: Ledger = {
    authorised,
    captured: 0,
    capturePending: 0,
    refunded: 0,
    refundPending: 0,
    cancelled: false,
    cancelPending: false,
  };
  for (const modification of modifications) {
    if (modification.kind === "cancel") {
      if (modification.status === "succeeded") ledger.cancelled = true;
      if (modification.status === "pending") ledger.cancelPending = true;
      continue;
    }
    if (modification.kind === "capture") {
      const value = modification.value ??
        Math.max(0, authorised - ledger.captured - ledger.capturePending);
      if (modification.status === "succeeded") ledger.captured += value;
      if (modification.status === "pending") ledger.capturePending += value;
      continue;
    }
    const value = modification.value ?? 0;
    if (modification.status === "succeeded") ledger.refunded += value;
    if (modification.status === "pending") ledger.refundPending += value;
  }
  ledger.captured = Math.min(ledger.captured, authorised);
  return ledger;
}

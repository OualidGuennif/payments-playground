import { test } from "bun:test";
import { assertEquals } from "../../../../testing/assert.ts";
import type { AttemptAggregate, AttemptState, TimelineEntry } from "@suite/platform/types.ts";
import { attemptForRedirect, earlierRedirectAnswer, reloadedResult } from "./redirect-return.ts";
import { RESULT_CODE_FOR_STATE } from "./orders.ts";

function call(redirectResult: string, status: string, response: object): TimelineEntry {
  return {
    id: crypto.randomUUID(),
    correlationId: "order",
    kind: "api_call",
    name: "Checkout API /payments/details",
    status,
    occurredAt: "2026-11-27T18:00:00Z",
    payload: { request: { details: { redirectResult } }, response: { ...response } },
  };
}

function attempt(state: AttemptState, pspReference?: string): AttemptAggregate {
  return {
    id: crypto.randomUUID(),
    orderId: "order",
    state,
    paymentMethod: "ideal",
    pspReference,
    amount: { currency: "EUR", value: 1000 },
    createdAt: "2026-11-27T18:00:00Z",
    updatedAt: "2026-11-27T18:00:00Z",
  };
}

// Refusals of earlier attempts on the same order: they settle its older attempts.
const REFUSED = ["P1", "P2", "P3", "P4", "P5"].map((psp) => attempt("refused", psp));

test("a redirect is a reload only when the same redirectResult was answered before", () => {
  const timeline = [
    call("R1", "200", { resultCode: "Authorised", pspReference: "P6" }),
    call("R2", "422", {}),
  ];
  assertEquals(earlierRedirectAnswer(timeline, "R1"), {
    resultCode: "Authorised",
    pspReference: "P6",
  });
  // A failed submission may be retried, and a new redirect is new, whatever the order holds.
  assertEquals(earlierRedirectAnswer(timeline, "R2"), undefined);
  assertEquals(earlierRedirectAnswer(timeline, "R3"), undefined);
  assertEquals(earlierRedirectAnswer([], "R1"), undefined);
});

test("a reload shows the stored state of the attempt its answer settled", () => {
  const settled = [...REFUSED, attempt("authorised", "P6")];
  assertEquals(
    reloadedResult({ resultCode: "Pending", pspReference: "P6" }, settled, RESULT_CODE_FOR_STATE),
    { resultCode: "Authorised", pspReference: "P6", paymentMethod: { type: "ideal" } },
  );
  // No stored attempt for that answer: the answer itself, never an older refusal.
  assertEquals(
    reloadedResult({ resultCode: "Pending", pspReference: "P7" }, REFUSED, RESULT_CODE_FOR_STATE),
    { resultCode: "Pending", pspReference: "P7" },
  );
});

test("a redirect answer settles the waiting attempt, else its own, never an older one", () => {
  const waiting = attempt("pending");
  assertEquals(attemptForRedirect([...REFUSED, waiting], "P6"), waiting);
  const webhookFirst = attempt("authorised", "P6");
  assertEquals(attemptForRedirect([...REFUSED, webhookFirst], "P6"), webhookFirst);
  assertEquals(attemptForRedirect(REFUSED, "P6"), undefined);
  assertEquals(attemptForRedirect(REFUSED, undefined), undefined);
});

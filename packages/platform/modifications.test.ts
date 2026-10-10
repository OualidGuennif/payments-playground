import { assertEquals } from "@std/assert";
import { ledgerOf, reconcile } from "./modifications.ts";
import type { ModificationEvent, ModificationRequest } from "./types.ts";

const request = (
  overrides: Partial<ModificationRequest> & Pick<ModificationRequest, "kind">,
): ModificationRequest => ({
  id: crypto.randomUUID(),
  state: "received",
  idempotencyKey: crypto.randomUUID(),
  createdAt: "2026-10-10T10:00:00.000Z",
  ...overrides,
});

const event = (
  overrides: Partial<ModificationEvent> & Pick<ModificationEvent, "eventCode">,
): ModificationEvent => ({
  success: true,
  receivedAt: "2026-10-10T10:00:05.000Z",
  ...overrides,
});

Deno.test("a received capture is pending until its webhook, then settled by it", () => {
  const capture = request({ kind: "capture", value: 4_000, pspReference: "CAP-1" });
  const pending = reconcile([capture], []);
  assertEquals(pending[0].status, "pending");
  assertEquals(ledgerOf(10_000, pending).capturePending, 4_000);

  const settled = reconcile([capture], [event({ eventCode: "CAPTURE", pspReference: "CAP-1" })]);
  assertEquals(settled[0].status, "succeeded");
  const ledger = ledgerOf(10_000, settled);
  assertEquals(ledger.captured, 4_000);
  assertEquals(ledger.capturePending, 0);
});

Deno.test("a refused capture and a later CAPTURE_FAILED leave nothing captured", () => {
  const refused = reconcile(
    [request({ kind: "capture", value: 10_000, pspReference: "CAP-1" })],
    [event({ eventCode: "CAPTURE", pspReference: "CAP-1", success: false, reason: "Expired" })],
  );
  assertEquals(refused[0].status, "failed");
  assertEquals(refused[0].reason, "Expired");

  const overturned = reconcile(
    [request({ kind: "capture", value: 10_000, pspReference: "CAP-2" })],
    [
      event({ eventCode: "CAPTURE", pspReference: "CAP-2" }),
      event({
        eventCode: "CAPTURE_FAILED",
        pspReference: "CAP-2",
        receivedAt: "2026-10-12T09:00:00.000Z",
      }),
    ],
  );
  assertEquals(overturned[0].status, "failed");
  assertEquals(ledgerOf(10_000, overturned).captured, 0);
});

Deno.test("multiple partial refunds add up; a reversed one does not count", () => {
  const modifications = reconcile(
    [
      request({ kind: "refund", value: 2_000, pspReference: "REF-1" }),
      request({ kind: "refund", value: 3_000, pspReference: "REF-2" }),
      request({ kind: "refund", value: 1_000, pspReference: "REF-3" }),
    ],
    [
      event({ eventCode: "REFUND", pspReference: "REF-1" }),
      event({ eventCode: "REFUND", pspReference: "REF-2" }),
      event({
        eventCode: "REFUNDED_REVERSED",
        pspReference: "REF-2",
        receivedAt: "2026-10-20T00:00:00.000Z",
      }),
    ],
  );
  const ledger = ledgerOf(10_000, modifications);
  assertEquals(ledger.refunded, 2_000);
  assertEquals(ledger.refundPending, 1_000);
});

Deno.test("a request the API rejected is never pending", () => {
  const modifications = reconcile(
    [request({ kind: "capture", value: 10_000, state: "rejected", reason: "422" })],
    [],
  );
  assertEquals(modifications[0].status, "rejected");
  assertEquals(ledgerOf(10_000, modifications).capturePending, 0);
});

Deno.test("a capture made in the Customer Area still counts, from its webhook", () => {
  const modifications = reconcile([], [
    event({ eventCode: "CAPTURE", pspReference: "CAP-9", value: 10_000 }),
  ]);
  assertEquals(modifications[0].external, true);
  assertEquals(ledgerOf(10_000, modifications).captured, 10_000);
});

Deno.test("an old request without its PSP reference takes the next event of its kind", () => {
  const modifications = reconcile(
    [request({ kind: "capture", createdAt: "2026-10-09T10:00:00.000Z" })],
    [event({
      eventCode: "CAPTURE",
      pspReference: "CAP-1",
      value: 10_000,
      receivedAt: "2026-10-09T10:00:04.000Z",
    })],
  );
  assertEquals(modifications.length, 1);
  assertEquals(modifications[0].status, "succeeded");
  assertEquals(ledgerOf(10_000, modifications).captured, 10_000);
});

Deno.test("a cancellation is pending, then cancels the authorisation", () => {
  const cancel = request({ kind: "cancel", pspReference: "CAN-1" });
  assertEquals(ledgerOf(10_000, reconcile([cancel], [])).cancelPending, true);
  const done = reconcile([cancel], [event({ eventCode: "CANCELLATION", pspReference: "CAN-1" })]);
  assertEquals(ledgerOf(10_000, done).cancelled, true);
});

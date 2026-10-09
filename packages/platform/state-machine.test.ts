import { assertEquals, assertStringIncludes } from "@std/assert";
import { resolveOrder } from "./state-machine.ts";

Deno.test("a refused attempt never closes a still-valid order", () => {
  const resolution = resolveOrder({
    currentState: "open",
    totalValue: 10_000,
    linkStatus: "active",
    attempts: [
      { id: "attempt-1", state: "refused", value: 10_000 },
      { id: "attempt-2", state: "refused", value: 10_000 },
    ],
  });

  assertEquals(resolution.state, "open");
  assertEquals(resolution.terminal, false);
  assertStringIncludes(resolution.reason, "refusal is attempt-level");
});

Deno.test("partial tender remains open for the balance", () => {
  const resolution = resolveOrder({
    currentState: "payment_pending",
    totalValue: 10_000,
    linkStatus: "paymentPending",
    attempts: [
      {
        id: "gift-card",
        state: "authorised",
        value: 4_000,
        pspReference: "PSP-GIFT",
      },
      { id: "card-refused", state: "refused", value: 6_000 },
    ],
  });

  assertEquals(resolution.state, "partially_paid");
  assertEquals(resolution.paidValue, 4_000);
  assertEquals(resolution.terminal, false);
});

Deno.test("duplicate authorised PSP references are counted once", () => {
  const resolution = resolveOrder({
    currentState: "payment_pending",
    totalValue: 10_000,
    linkStatus: "paymentPending",
    attempts: [
      { id: "first", state: "authorised", value: 4_000, pspReference: "PSP-1" },
      { id: "duplicate", state: "authorised", value: 4_000, pspReference: "PSP-1" },
    ],
  });

  assertEquals(resolution.paidValue, 4_000);
  assertEquals(resolution.state, "partially_paid");
});

Deno.test("ORDER_CLOSED is authoritative for partial payment orders", () => {
  const resolution = resolveOrder({
    currentState: "partially_paid",
    totalValue: 10_000,
    orderClosedWebhook: { success: true },
    attempts: [
      { id: "gift", state: "authorised", value: 4_000, pspReference: "PSP-1" },
      { id: "card", state: "authorised", value: 6_000, pspReference: "PSP-2" },
    ],
  });

  assertEquals(resolution.state, "paid");
  assertEquals(resolution.paidValue, 10_000);
  assertEquals(resolution.terminal, true);
});

Deno.test("effective link expiration closes the order", () => {
  const resolution = resolveOrder(
    {
      currentState: "open",
      totalValue: 10_000,
      expiresAt: "2026-01-01T00:00:00.000Z",
      attempts: [{ id: "refused", state: "refused", value: 10_000 }],
    },
    new Date("2026-01-02T00:00:00.000Z"),
  );

  assertEquals(resolution.state, "expired");
  assertEquals(resolution.terminal, true);
});

Deno.test("a successful CAPTURE webhook settles the order as paid", () => {
  const resolution = resolveOrder({
    currentState: "payment_pending",
    totalValue: 10_000,
    modificationWebhook: { kind: "capture", success: true },
    attempts: [{ id: "card", state: "authorised", value: 10_000, pspReference: "PSP-1" }],
  });

  assertEquals(resolution.state, "paid");
  assertEquals(resolution.terminal, true);
});

Deno.test("a failed CAPTURE webhook leaves the authorisation where it was", () => {
  const resolution = resolveOrder({
    currentState: "payment_pending",
    totalValue: 10_000,
    modificationWebhook: { kind: "capture", success: false },
    attempts: [{ id: "card", state: "authorised", value: 10_000, pspReference: "PSP-1" }],
  });

  assertEquals(resolution.state, "payment_pending");
});

Deno.test("a successful CANCELLATION webhook cancels the order", () => {
  const resolution = resolveOrder({
    currentState: "payment_pending",
    totalValue: 10_000,
    modificationWebhook: { kind: "cancel", success: true },
    attempts: [{ id: "card", state: "authorised", value: 10_000, pspReference: "PSP-1" }],
  });

  assertEquals(resolution.state, "cancelled");
});

Deno.test("a later webhook never reopens a settled order", () => {
  for (const currentState of ["paid", "cancelled"] as const) {
    const resolution = resolveOrder({
      currentState,
      totalValue: 10_000,
      attempts: [{ id: "card", state: "authorised", value: 10_000, pspReference: "PSP-1" }],
    });

    assertEquals(resolution.state, currentState);
    assertEquals(resolution.terminal, true);
  }
});

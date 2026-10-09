import { assertEquals, assertStringIncludes } from "@std/assert";
import { actionPermissions, capabilitiesFor, lifecycleSourceAttempt } from "./lifecycle.ts";
import type { AttemptAggregate } from "./types.ts";

Deno.test("scheme authorisation can be captured or cancelled before capture", () => {
  const permissions = actionPermissions("payment_pending", "scheme");
  assertEquals(permissions.capture.allowed, true);
  assertEquals(permissions.cancel.allowed, true);
  assertEquals(permissions.refund.allowed, false);
});

Deno.test("iDEAL and MB WAY are settlement-only with explicit explanations", () => {
  for (const method of ["ideal", "mbway"]) {
    const permissions = actionPermissions("payment_pending", method);
    assertEquals(permissions.capture.allowed, false);
    assertEquals(permissions.cancel.allowed, false);
    assertStringIncludes(permissions.capture.reason, "separate capture");
  }
});

Deno.test("PayPal playground default is settlement only", () => {
  const capability = capabilitiesFor("paypal");
  assertEquals(capability.settlementOnly, true);
  assertEquals(actionPermissions("payment_pending", "paypal").capture.allowed, false);
});

Deno.test("captured methods expose refunds and disable capture", () => {
  const permissions = actionPermissions("paid", "scheme");
  assertEquals(permissions.capture.allowed, false);
  assertEquals(permissions.cancel.allowed, false);
  assertEquals(permissions.refund.allowed, true);
});

Deno.test("a method captured on authorisation can be refunded once authorised", () => {
  for (const method of ["ideal", "paypal"]) {
    assertEquals(actionPermissions("payment_pending", method, 0).refund.allowed, false);
    const permissions = actionPermissions("payment_pending", method, 10_000);
    assertEquals(permissions.refund.allowed, true);
    assertEquals(permissions.capture.allowed, false);
  }
  assertEquals(actionPermissions("cancelled", "ideal", 10_000).refund.allowed, false);
});

Deno.test("a manually captured card still needs its CAPTURE before a refund", () => {
  assertEquals(actionPermissions("payment_pending", "scheme", 10_000).refund.allowed, false);
});

Deno.test("lifecycle actions target the latest authorised attempt, not a later refusal", () => {
  const attempt = (id: string, state: AttemptAggregate["state"]): AttemptAggregate => ({
    id,
    orderId: "order-1",
    state,
    pspReference: `PSP-${id}`,
    amount: { value: 10_000, currency: "EUR" },
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  });

  const source = lifecycleSourceAttempt([attempt("1", "authorised"), attempt("2", "refused")]);
  assertEquals(source?.id, "1");
  assertEquals(lifecycleSourceAttempt([attempt("1", "refused")]), undefined);
});

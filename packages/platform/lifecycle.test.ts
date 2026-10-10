import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  actionPermissions,
  CAPABILITIES_REVIEWED_ON,
  CAPABILITIES_SOURCE,
  capabilitiesFor,
  emptyLedger,
  lifecycleSourceAttempt,
} from "./lifecycle.ts";
import type { AttemptAggregate, Ledger } from "./types.ts";

const AUTHORISED = 10_000;
const ledger = (overrides: Partial<Ledger> = {}): Ledger => ({
  ...emptyLedger(AUTHORISED),
  ...overrides,
});

Deno.test("the capability table was checked against Adyen's docs within three months", () => {
  const ageDays = (Date.now() - Date.parse(CAPABILITIES_REVIEWED_ON)) / 86_400_000;
  if (ageDays > 92) {
    throw new Error(
      `PAYMENT_METHOD_CAPABILITIES was last checked on ${CAPABILITIES_REVIEWED_ON}. ` +
        `Re-check every method against ${CAPABILITIES_SOURCE}, fix what changed, ` +
        `then bump CAPABILITIES_REVIEWED_ON in packages/platform/lifecycle.ts.`,
    );
  }
});

Deno.test("a manually captured card can be captured in part or cancelled, not refunded", () => {
  const permissions = actionPermissions("payment_pending", "scheme", ledger());
  assertEquals(permissions.capture.allowed, true);
  assertEquals(permissions.capture.maxValue, AUTHORISED);
  assertEquals(permissions.capture.partial, true);
  assertEquals(permissions.cancel.allowed, true);
  assertEquals(permissions.refund.allowed, false);
});

Deno.test("a received capture blocks the next one until its webhook arrives", () => {
  const permissions = actionPermissions(
    "payment_pending",
    "scheme",
    ledger({ capturePending: AUTHORISED }),
  );
  assertEquals(permissions.capture.allowed, false);
  assertEquals(permissions.capture.waiting, true);
  assertStringIncludes(permissions.capture.reason, "CAPTURE webhook");
  assertEquals(permissions.cancel.allowed, false);
  assertEquals(permissions.refund.allowed, false);
});

Deno.test("cards take multiple partial captures up to what is authorised", () => {
  const permissions = actionPermissions("paid", "scheme", ledger({ captured: 4_000 }));
  assertEquals(permissions.capture.allowed, true);
  assertEquals(permissions.capture.maxValue, 6_000);
  assertStringIncludes(permissions.capture.reason, "multiple partial captures enabled");
  assertEquals(permissions.refund.allowed, true);
  assertEquals(permissions.refund.maxValue, 4_000);
  assertEquals(permissions.cancel.allowed, false);
});

Deno.test("Alma and Oney take one partial capture at most", () => {
  for (const method of ["alma", "facilypay_3x", "facilypay_4x"]) {
    const permissions = actionPermissions("paid", method, ledger({ captured: 4_000 }));
    assertEquals(permissions.capture.allowed, false, method);
    assertStringIncludes(permissions.capture.reason, "one partial capture");
  }
});

Deno.test("refunds add up to what is captured, one webhook at a time", () => {
  const partly = actionPermissions(
    "paid",
    "scheme",
    ledger({ captured: AUTHORISED, refunded: 3_000 }),
  );
  assertEquals(partly.refund.allowed, true);
  assertEquals(partly.refund.maxValue, 7_000);

  const waiting = actionPermissions(
    "paid",
    "scheme",
    ledger({ captured: AUTHORISED, refundPending: 2_000 }),
  );
  assertEquals(waiting.refund.allowed, false);
  assertEquals(waiting.refund.waiting, true);

  const done = actionPermissions(
    "paid",
    "scheme",
    ledger({ captured: AUTHORISED, refunded: AUTHORISED }),
  );
  assertEquals(done.refund.allowed, false);
});

Deno.test("ANCV is refunded once and in full", () => {
  const first = actionPermissions("paid", "ancv", ledger({ captured: AUTHORISED }));
  assertEquals(first.refund.allowed, true);
  assertEquals(first.refund.partial, false);
  const second = actionPermissions(
    "paid",
    "ancv",
    ledger({ captured: AUTHORISED, refunded: 1_000 }),
  );
  assertEquals(second.refund.allowed, false);
  assertStringIncludes(second.refund.reason, "one refund");
});

Deno.test("methods without separate capture are refunded, never captured or cancelled", () => {
  for (const method of ["ideal", "mbway", "wero", "wechatpayQR", "paybybank"]) {
    const permissions = actionPermissions("payment_pending", method, ledger());
    assertEquals(permissions.capture.allowed, false, method);
    assertStringIncludes(permissions.capture.reason, "no separate capture");
    assertEquals(permissions.cancel.allowed, false, method);
    assertEquals(permissions.refund.allowed, true, method);
    assertEquals(permissions.refund.maxValue, AUTHORISED, method);
  }
});

Deno.test("PayPal supports separate capture but this account captures it on authorisation", () => {
  const capability = capabilitiesFor("paypal");
  assertEquals(capability.separateCapture, true);
  assertEquals(capability.multiplePartialCaptures, true);
  assertEquals(capability.automaticCapture, true);
  const permissions = actionPermissions("payment_pending", "paypal", ledger());
  assertEquals(permissions.capture.allowed, false);
  assertStringIncludes(permissions.capture.reason, "merchant account captures");
  assertEquals(permissions.refund.allowed, true);
});

Deno.test("a method captured on authorisation has nothing to refund until authorised", () => {
  assertEquals(actionPermissions("open", "ideal", emptyLedger(0)).refund.allowed, false);
  assertEquals(actionPermissions("cancelled", "ideal", ledger()).refund.allowed, false);
});

Deno.test("a manually captured card still needs its CAPTURE before a refund", () => {
  assertEquals(actionPermissions("payment_pending", "scheme", ledger()).refund.allowed, false);
});

Deno.test("methods with separate capture follow the account's manual capture", () => {
  for (
    const method of ["googlepay", "applepay", "klarna_account", "alma", "facilypay_3x", "ancv"]
  ) {
    const permissions = actionPermissions("payment_pending", method, ledger());
    assertEquals(permissions.capture.allowed, true, method);
    assertEquals(permissions.cancel.allowed, true, method);
    assertEquals(permissions.refund.allowed, false, method);
  }
  assertEquals(capabilitiesFor("ancv").partialRefund, false);
  assertEquals(capabilitiesFor("alma").validityMinutes, 30 * 24 * 60);
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

import { test } from "bun:test";
import { assertEquals } from "../../../../testing/assert.ts";
import type { OrderState } from "@suite/platform/types.ts";
import { renewalDecision } from "./session-renewal.ts";

const DUE = {
  flow: "sessions-dropin",
  orderState: "open" as OrderState,
  sameProfile: true,
  session: { state: "created" as const, adyenSessionId: "CS1" },
  refusals: 5,
};

test("four refusals wait, the fifth renews", () => {
  for (const refusals of [0, 1, 4]) {
    assertEquals(renewalDecision({ ...DUE, refusals }), { kind: "wait", refusals });
  }
  assertEquals(renewalDecision(DUE), { kind: "renew", refusals: 5 });
  assertEquals(renewalDecision({ ...DUE, refusals: 7 }), { kind: "renew", refusals: 7 });
});

test("a settled or expired order is never renewed", () => {
  const states: OrderState[] = [
    "payment_pending",
    "partially_paid",
    "paid",
    "cancelled",
    "expired",
    "failed",
  ];
  for (const orderState of states) {
    assertEquals(renewalDecision({ ...DUE, orderState }).kind, "refuse");
  }
});

test("a session being renewed makes the next request wait", () => {
  assertEquals(renewalDecision({ ...DUE, session: { state: "renewing", adyenSessionId: "CS1" } }), {
    kind: "wait",
    refusals: 5,
  });
  assertEquals(
    renewalDecision({ ...DUE, session: { state: "replaced", adyenSessionId: "CS1" } }).kind,
    "refuse",
  );
});

test("an order that is not a Sessions order of this profile, or has no session, is refused", () => {
  assertEquals(renewalDecision({ ...DUE, flow: "advanced-dropin" }).kind, "refuse");
  assertEquals(renewalDecision({ ...DUE, sameProfile: false }).kind, "refuse");
  assertEquals(renewalDecision({ ...DUE, session: undefined }).kind, "refuse");
  assertEquals(renewalDecision({ ...DUE, session: { state: "created" } }).kind, "refuse");
});

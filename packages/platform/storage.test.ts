import { assertEquals } from "@std/assert";
import { Repository } from "./storage.ts";

Deno.test("webhooks and lifecycle actions are deduplicated idempotently", () => {
  const repository = new Repository(":memory:");
  try {
    const webhook = {
      appId: "digital" as const,
      dedupeKey: "AUTHORISATION:PSP-1:true",
      correlationId: "order-1",
      eventType: "AUTHORISATION",
      pspReference: "PSP-1",
      hmacValid: true,
      payload: { apiKey: "never-persist-this" },
    };
    assertEquals(repository.recordWebhook(webhook).duplicate, false);
    assertEquals(repository.recordWebhook(webhook).duplicate, true);

    const action = {
      appId: "digital" as const,
      correlationId: "order-1",
      action: "capture",
      state: "requested",
      idempotencyKey: "capture-order-1",
      payload: { amount: { value: 1000, currency: "EUR" } },
    };
    assertEquals(repository.recordAction(action).duplicate, false);
    assertEquals(repository.recordAction(action).duplicate, true);

    const timeline = repository.timeline("order-1");
    assertEquals(timeline.length, 2);
    assertEquals(
      (timeline.find((entry) => entry.kind === "webhook")?.payload as Record<string, unknown>)
        .apiKey,
      "[redacted]",
    );
  } finally {
    repository.close();
  }
});

Deno.test("modification requests and their webhooks read back for reconciliation", () => {
  const repository = new Repository(":memory:");
  try {
    const order = repository.createOrder({
      appId: "digital",
      flow: "sessions-dropin",
      amount: { value: 10_000, currency: "EUR" },
    });
    const action = repository.recordAction({
      appId: "digital",
      orderId: order.id,
      correlationId: order.id,
      action: "capture",
      state: "requested",
      idempotencyKey: "key-1",
      payload: { amount: { value: 4_000, currency: "EUR" } },
    });
    repository.updateAction(action.id, { state: "received", pspReference: "CAP-1" });
    const [stored] = repository.listActions(order.id);
    assertEquals(stored.state, "received");
    assertEquals(stored.value, 4_000);
    assertEquals(stored.pspReference, "CAP-1");
    assertEquals(repository.findAction("key-1")?.id, action.id);

    for (const [hmacValid, eventType] of [[true, "CAPTURE"], [false, "REFUND"]] as const) {
      repository.recordWebhook({
        appId: "digital",
        dedupeKey: `${eventType}:CAP-1`,
        correlationId: order.id,
        eventType,
        pspReference: "CAP-1",
        hmacValid,
        payload: { success: "true", pspReference: "CAP-1", amount: { value: 4_000 } },
      });
    }
    // Only the HMAC-valid event counts.
    const events = repository.modificationEvents(order.id);
    assertEquals(events.length, 1);
    assertEquals(events[0].eventCode, "CAPTURE");
    assertEquals(events[0].value, 4_000);
  } finally {
    repository.close();
  }
});

Deno.test("the timeline gives each API call its method and endpoint", () => {
  const repository = new Repository(":memory:");
  try {
    repository.recordApiCall({
      appId: "digital",
      correlationId: "order-2",
      name: "Checkout API /payments",
      method: "POST",
      endpoint: "https://checkout-test.adyen.com/v72/payments",
      status: 200,
      durationMs: 412,
      request: { amount: { value: 1000, currency: "EUR" } },
      response: { resultCode: "Authorised" },
    });
    const [entry] = repository.timeline("order-2");
    assertEquals(entry.method, "POST");
    assertEquals(entry.endpoint, "https://checkout-test.adyen.com/v72/payments");
  } finally {
    repository.close();
  }
});

Deno.test("orders beyond the retained cap are purged per app on creation", () => {
  const repository = new Repository(":memory:");
  try {
    for (let index = 0; index < 75; index++) {
      repository.createOrder({
        appId: "digital",
        flow: "sessions-dropin",
        amount: { value: 1000, currency: "EUR" },
      });
    }
    assertEquals(repository.listOrders("digital", 200).length, 70);
  } finally {
    repository.close();
  }
});

Deno.test("one PSP reference records one payment part, however often it is reported", () => {
  const repository = new Repository(":memory:");
  try {
    const order = repository.createOrder({
      appId: "digital",
      flow: "advanced-dropin",
      amount: { value: 1000, currency: "EUR" },
    });
    const part = {
      orderId: order.id,
      pspReference: "PSP-1",
      amount: { value: 1000, currency: "EUR" },
      state: "authorised",
    };
    const first = repository.recordPaymentPart(part);
    assertEquals(repository.recordPaymentPart(part), first);
    const count = repository.database.prepare<{ count: number }>(
      "SELECT COUNT(*) AS count FROM payment_parts WHERE order_id = ?",
    ).get(order.id);
    assertEquals(count?.count, 1);
  } finally {
    repository.close();
  }
});

Deno.test("an order is found from an attempt's PSP reference and its Adyen session", () => {
  const repository = new Repository(":memory:");
  try {
    const order = repository.createOrder({
      appId: "digital",
      flow: "sessions-dropin",
      amount: { value: 1000, currency: "EUR" },
    });
    repository.createSession({ orderId: order.id, kind: "sessions-dropin", adyenSessionId: "CS1" });
    repository.createAttempt({
      orderId: order.id,
      amount: { value: 1000, currency: "EUR" },
      state: "authorised",
      pspReference: "PSP-1",
    });

    assertEquals(repository.findOrderByPspReference("PSP-1")?.id, order.id);
    assertEquals(repository.findOrderByPspReference("PSP-unknown"), undefined);
    assertEquals(repository.findAdyenSessionId(order.id), "CS1");
  } finally {
    repository.close();
  }
});

import { test } from "bun:test";
import { assert, assertEquals } from "../../../../testing/assert.ts";
import type { OrderAggregate, ProfileSecrets } from "@suite/platform/types.ts";
import { buildPaymentRequest, buildSessionRequest } from "./api.ts";

const ORDER: OrderAggregate = {
  id: "order-test-1",
  reference: "digital-1700000000000-order",
  appId: "digital",
  flow: "sessions-dropin",
  state: "open",
  amount: { value: 2599, currency: "EUR" },
  paidValue: 0,
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
};

const SECRETS: ProfileSecrets = {
  merchantAccount: "TestMerchant",
  apiKey: "test-api-key",
  clientKey: "test_client_key",
};

function assertValidMetadata(metadata: unknown, expectedFlow: string) {
  const entries = Object.entries(metadata as Record<string, string>);
  assertEquals(entries.length, 2);
  assertEquals(metadata, { playground: "adyen-digital", flow: expectedFlow });
  for (const [key, value] of entries) {
    assert(key.length <= 20, `metadata key "${key}" exceeds 20 chars`);
    assertEquals(typeof value, "string");
    assert(value.length <= 80, `metadata value "${value}" exceeds 80 chars`);
  }
}

test("sessions sends two-key metadata and omits names from deliveryAddress", () => {
  const request = buildSessionRequest({
    body: {
      countryCode: "FR",
      firstName: "Alice",
      lastName: "Tester",
      deliveryAddress: { firstName: "Alice", lastName: "Tester", city: "Lyon" },
    },
    secrets: SECRETS,
    order: ORDER,
    origin: "http://localhost:8001",
    expiresAt: "2026-11-16T01:00:00.000Z",
  });

  assertValidMetadata(request.metadata, "sessions");
  const delivery = request.deliveryAddress as Record<string, unknown>;
  assertEquals(delivery.city, "Lyon");
  assertEquals("firstName" in delivery, false);
  assertEquals("lastName" in delivery, false);
});

test("advanced payments sends two-key metadata and omits names from deliveryAddress", () => {
  const request = buildPaymentRequest({
    body: {
      countryCode: "FR",
      deliveryAddress: { firstName: "Bob", lastName: "Buyer", city: "Paris" },
    },
    secrets: SECRETS,
    order: { ...ORDER, flow: "advanced-dropin" },
    origin: "http://localhost:8001",
    paymentMethod: { type: "scheme" },
    amount: ORDER.amount,
    metadataFlow: "advanced",
  });

  assertValidMetadata(request.metadata, "advanced");
  const delivery = request.deliveryAddress as Record<string, unknown>;
  assertEquals(delivery.city, "Paris");
  assertEquals("firstName" in delivery, false);
  assertEquals("lastName" in delivery, false);
});

test("api-only payments sends two-key metadata and omits names from deliveryAddress", () => {
  const request = buildPaymentRequest({
    body: {
      countryCode: "FR",
      deliveryAddress: { firstName: "Cara", lastName: "Shopper" },
    },
    secrets: SECRETS,
    order: { ...ORDER, flow: "api-only-pci" },
    origin: "http://localhost:8001",
    paymentMethod: { type: "scheme" },
    amount: ORDER.amount,
    metadataFlow: "api-only",
  });

  assertValidMetadata(request.metadata, "api-only");
  const delivery = request.deliveryAddress as Record<string, unknown>;
  assertEquals("firstName" in delivery, false);
  assertEquals("lastName" in delivery, false);
});

test("a payment into an Adyen order asks for its own share, not the order's total", () => {
  const adyenOrder = { orderData: "order-data", pspReference: "ORDER_PSP" };
  const order = {
    ...ORDER,
    flow: "advanced-components",
    amount: { value: 10000, currency: "EUR" },
  };
  const share = { value: 2500, currency: "EUR" };
  const request = buildPaymentRequest({
    body: { countryCode: "FR" },
    secrets: SECRETS,
    order,
    origin: "http://localhost:8001",
    paymentMethod: { type: "giftcard" },
    metadataFlow: "advanced",
    adyenOrder,
    amount: share,
  });

  assertEquals(request.amount, share);
  assertEquals(request.order, adyenOrder);
});

test("a payment outside an Adyen order asks for the order's amount", () => {
  const request = buildPaymentRequest({
    body: { countryCode: "FR" },
    secrets: SECRETS,
    order: ORDER,
    origin: "http://localhost:8001",
    paymentMethod: { type: "scheme" },
    metadataFlow: "advanced",
    // Another amount than the order's, so the test fails if the builder sent it.
    amount: { value: 1234, currency: "EUR" },
  });

  assertEquals(request.amount, ORDER.amount);
  assertEquals("order" in request, false);
});

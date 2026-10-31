// Spec: knowledge/components/adyen-ipp-endless-aisle.md
import { AdyenTestClient } from "@suite/platform/adyen.ts";
import { createPlatformContext, selectedSecrets } from "@suite/platform/base-api.ts";
import { verifyHeaderHmac } from "@suite/platform/hmac.ts";
import { sanitize } from "@suite/platform/sanitize.ts";
import { resolveOrder } from "@suite/platform/state-machine.ts";
import type { Amount, ProfileSecrets } from "@suite/platform/types.ts";
import type { Context } from "hono";

const context = createPlatformContext("ipp");
export const api = context.api;

const CATALOGUE = [
  {
    id: "EA-101",
    name: "Performance running jacket",
    price: 12900,
    currency: "EUR",
    stock: "warehouse",
  },
  {
    id: "EA-204",
    name: "Everyday commuter backpack",
    price: 7900,
    currency: "EUR",
    stock: "warehouse",
  },
  { id: "EA-318", name: "Trail footwear", price: 14900, currency: "EUR", stock: "another-store" },
  { id: "EA-422", name: "Merino base layer", price: 6400, currency: "EUR", stock: "warehouse" },
] as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function basketAmount(value: unknown): Amount {
  const lines = Array.isArray(value) ? value : [];
  let total = 0;
  for (const rawLine of lines) {
    const line = object(rawLine);
    const product = CATALOGUE.find((entry) => entry.id === line.productId);
    const quantity = Number(line.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Basket contains an invalid item or quantity.");
    }
    total += product.price * quantity;
  }
  if (total < 1) throw new Error("Basket is empty.");
  return { value: total, currency: "EUR" };
}

function terminalRequest(input: {
  reference: string;
  terminalId: string;
  amount: Amount;
  serviceId: string;
}): Record<string, unknown> {
  return {
    SaleToPOIRequest: {
      MessageHeader: {
        ProtocolVersion: "3.0",
        MessageClass: "Service",
        MessageCategory: "Payment",
        MessageType: "Request",
        ServiceID: input.serviceId.slice(0, 10),
        SaleID: "EndlessAisle",
        POIID: input.terminalId,
      },
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: {
            TransactionID: input.reference.slice(0, 32),
            TimeStamp: new Date().toISOString(),
          },
        },
        PaymentTransaction: {
          AmountsReq: {
            Currency: input.amount.currency,
            RequestedAmount: input.amount.value / 100,
          },
        },
      },
    },
  };
}

function terminalResult(response: unknown): {
  success: boolean;
  result: string;
  pspReference?: string;
} {
  const saleToPoi = object(object(response).SaleToPOIResponse);
  const paymentResponse = object(saleToPoi.PaymentResponse);
  const responseData = object(paymentResponse.Response);
  const result = String(responseData.Result ?? "Unknown");
  const poiData = object(paymentResponse.POIData);
  return {
    success: result.toLowerCase() === "success",
    result,
    pspReference: String(poiData.POITransactionID ?? "") || undefined,
  };
}

async function selected(request: Request) {
  const profile = await selectedSecrets(context, request);
  if (!profile.secrets.merchantAccount || !profile.secrets.terminalId) {
    throw new Error("The selected TEST profile requires merchantAccount and terminalId.");
  }
  return { ...profile, client: new AdyenTestClient(profile.secrets) };
}

api.get("/api/ipp/catalogue", (c) => c.json({ products: CATALOGUE }));

api.get("/api/ipp/orders", (c) => {
  const orders = context.repository.listOrders("ipp").map((order) => ({
    ...order,
    attempts: context.repository.listAttempts(order.id),
    timeline: context.repository.timeline(order.id),
  }));
  return c.json({ orders });
});

api.get("/api/ipp/orders/:id", (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "Transaction not found." }, 404);
  return c.json({
    order,
    attempts: context.repository.listAttempts(order.id),
    timeline: context.repository.timeline(order.id),
  });
});

api.get("/api/ipp/terminals", async (c) => {
  const { client } = await selected(c.req.raw);
  const correlationId = crypto.randomUUID();
  const started = performance.now();
  try {
    const response = await client.connectedDevices();
    context.repository.recordApiCall({
      appId: "ipp",
      correlationId,
      name: "Cloud Device API connected devices",
      method: "GET",
      endpoint: "https://device-api-test.adyen.com/v1/merchants/{merchant}/devices",
      status: 200,
      durationMs: Math.round(performance.now() - started),
      request: {},
      response,
    });
    return c.json({ correlationId, response });
  } catch (error) {
    context.repository.recordApiCall({
      appId: "ipp",
      correlationId,
      name: "Cloud Device API connected devices",
      method: "GET",
      endpoint: "https://device-api-test.adyen.com/v1/merchants/{merchant}/devices",
      status: 500,
      durationMs: Math.round(performance.now() - started),
      request: {},
      response: {},
      error: error instanceof Error ? error.message : "Request failed.",
    });
    throw error;
  }
});

const ippPaymentHandler = async (c: Context): Promise<Response> => {
  const body = object(await c.req.json());
  const amount = basketAmount(body.lines);
  const mode = body.mode === "real-test" ? "real-test" : "mock";
  const profile = await selectedSecrets(context, c.req.raw);
  const order = context.repository.createOrder({
    appId: "ipp",
    flow: `terminal-${mode}`,
    amount,
    metadata: { lines: body.lines, profileId: profile.id, mode },
  });
  const attempt = context.repository.createAttempt({
    orderId: order.id,
    amount,
    state: "pending",
    paymentMethod: "terminal",
  });
  context.repository.updateOrder(order.id, { state: "payment_pending" });
  const serviceId = order.id.replaceAll("-", "").slice(0, 10);

  if (mode === "mock") {
    const mockResponse = {
      simulated: true,
      provider: "local-terminal-simulator",
      status: "Success",
      message:
        "No Adyen endpoint was called. Switch explicitly to Real TEST when a connected TEST terminal is available.",
      serviceId,
    };
    context.repository.recordApiCall({
      appId: "ipp",
      correlationId: order.id,
      name: "Local Terminal API simulation",
      method: "POST",
      endpoint: "mock://terminal/payment",
      status: 200,
      durationMs: 120,
      request: { amount, lines: body.lines },
      response: mockResponse,
    });
    context.repository.updateAttempt(attempt.id, {
      state: "authorised",
      pspReference: `MOCK-${order.id.slice(0, 12)}`,
    });
    context.repository.recordPaymentPart({
      orderId: order.id,
      attemptId: attempt.id,
      pspReference: `MOCK-${order.id.slice(0, 12)}`,
      amount,
      state: "authorised",
    });
    context.repository.updateOrder(order.id, { state: "paid", paidValue: amount.value });
    context.repository.audit({
      appId: "ipp",
      correlationId: order.id,
      action: "terminal.payment",
      outcome: "simulated",
      payload: { mode },
    });
    return c.json({ correlationId: order.id, mode, response: mockResponse }, 201);
  }

  if (!profile.secrets.terminalId || !profile.secrets.merchantAccount) {
    return c.json({
      error: "Real TEST mode requires a configured merchantAccount and connected terminalId.",
    }, 409);
  }
  const request = terminalRequest({
    reference: order.reference,
    terminalId: profile.secrets.terminalId,
    amount,
    serviceId,
  });
  const client = new AdyenTestClient(profile.secrets);
  const started = performance.now();
  try {
    const response = await client.terminalSync(request);
    const parsed = terminalResult(response);
    context.repository.recordApiCall({
      appId: "ipp",
      correlationId: order.id,
      name: "Cloud Device API synchronous payment",
      method: "POST",
      endpoint: "https://device-api-test.adyen.com/v1/merchants/{merchant}/devices/{device}/sync",
      status: 200,
      durationMs: Math.round(performance.now() - started),
      request,
      response,
    });
    context.repository.updateAttempt(attempt.id, {
      state: parsed.success ? "authorised" : "refused",
      pspReference: parsed.pspReference,
      refusalReason: parsed.success ? undefined : parsed.result,
    });
    const resolution = resolveOrder({
      currentState: "payment_pending",
      totalValue: amount.value,
      attempts: [{
        id: attempt.id,
        state: parsed.success ? "authorised" : "refused",
        value: amount.value,
        pspReference: parsed.pspReference,
      }],
    });
    context.repository.updateOrder(order.id, {
      state: parsed.success ? "paid" : resolution.state,
      paidValue: parsed.success ? amount.value : 0,
    });
    return c.json({ correlationId: order.id, mode, response: sanitize(response) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Terminal request failed.";
    context.repository.recordApiCall({
      appId: "ipp",
      correlationId: order.id,
      name: "Cloud Device API synchronous payment",
      method: "POST",
      endpoint: "https://device-api-test.adyen.com/v1/merchants/{merchant}/devices/{device}/sync",
      status: 500,
      durationMs: Math.round(performance.now() - started),
      request,
      response: {},
      error: message,
    });
    context.repository.updateAttempt(attempt.id, { state: "error", refusalReason: message });
    context.repository.updateOrder(order.id, { state: "failed" });
    throw error;
  }
};

api.post("/api/ipp/payments", ippPaymentHandler as never);

api.post("/api/ipp/orders/:id/cancel", (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "Transaction not found." }, 404);
  if (!["open", "payment_pending"].includes(order.state)) {
    return c.json({ error: `Cancellation is unavailable while ${order.state}.` }, 409);
  }
  const idempotencyKey = String(c.req.header("idempotency-key") ?? crypto.randomUUID());
  const result = context.repository.recordAction({
    appId: "ipp",
    orderId: order.id,
    correlationId: order.id,
    action: "cancel",
    state: "received",
    idempotencyKey,
    payload: {},
  });
  if (result.duplicate) return c.json({ duplicate: true, actionId: result.id });
  context.repository.updateOrder(order.id, { state: "cancelled" });
  context.repository.audit({
    appId: "ipp",
    correlationId: order.id,
    action: "terminal.cancel",
    outcome: "local-state-cancelled",
    payload: {
      note:
        "A live abort request is terminal-state dependent. This endpoint records the operator request idempotently.",
    },
  });
  return c.json({ actionId: result.id, state: "cancelled" }, 202);
});

async function allWebhookSecrets(): Promise<ProfileSecrets[]> {
  const profiles = await context.profiles.listPublic();
  const result: ProfileSecrets[] = [];
  for (const profile of profiles) {
    const secrets = await context.profiles.getSecrets(profile.id);
    if (secrets) result.push(secrets);
  }
  return result;
}

function basicAuthValid(header: string | undefined, secrets: ProfileSecrets[]): boolean {
  const configured = secrets.filter((entry) =>
    entry.webhookBasicAuthUser && entry.webhookBasicAuthPassword
  );
  if (!configured.length) return true;
  if (!header?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  return configured.some((entry) =>
    decoded === `${entry.webhookBasicAuthUser}:${entry.webhookBasicAuthPassword}`
  );
}

api.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const secrets = await allWebhookSecrets();
  if (!basicAuthValid(c.req.header("authorization"), secrets)) {
    return c.json({ error: "Invalid webhook Basic Auth." }, 401);
  }
  const hmacConfigured = secrets.filter((entry) => entry.hmacKey);
  let hmacValid = hmacConfigured.length === 0;
  for (const entry of hmacConfigured) {
    if (await verifyHeaderHmac(rawBody, c.req.header("hmacsignature"), entry.hmacKey)) {
      hmacValid = true;
      break;
    }
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON." }, 400);
  }
  const root = object(payload);
  const saleToPoi = object(root.SaleToPOIResponse ?? root.SaleToPOIRequest);
  const messageHeader = object(saleToPoi.MessageHeader);
  const serviceId = String(messageHeader.ServiceID ?? "");
  const order = context.repository.listOrders("ipp").find((candidate) =>
    candidate.id.replaceAll("-", "").startsWith(serviceId)
  );
  const correlationId = order?.id ?? (serviceId || "unmatched-terminal-event");
  const eventType = String(messageHeader.MessageCategory ?? "TerminalEvent");
  const dedupeKey = [
    messageHeader.ServiceID,
    messageHeader.MessageCategory,
    messageHeader.MessageType,
    object(object(saleToPoi.PaymentResponse).POIData).POITransactionID,
  ].join(":");
  context.repository.recordWebhook({
    appId: "ipp",
    dedupeKey,
    correlationId,
    eventType,
    hmacValid,
    payload,
  });
  if (!hmacValid) return c.json({ error: "Invalid webhook HMAC." }, 401);
  return c.text("[accepted]", 202);
});

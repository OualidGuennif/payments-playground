// Spec: knowledge/components/adyen-agentic-commerce.md
import { AdyenTestClient } from "@suite/platform/adyen.ts";
import { buildCheckoutAddresses } from "@suite/platform/addresses.ts";
import { createPlatformContext, selectedSecrets } from "@suite/platform/base-api.ts";
import { type StandardWebhookItem, verifyStandardHmac } from "@suite/platform/hmac.ts";
import { sanitize } from "@suite/platform/sanitize.ts";
import {
  buildLineItems,
  resolveShopperEmail,
  sessionRiskFields,
} from "@suite/platform/sessionContext.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import type { ProfileSecrets } from "@suite/platform/types.ts";
import { OFFERS, realAgenticUnavailableReason, runLocalAgenticMock } from "./providers.ts";

const context = createPlatformContext("agentic");
export const api = context.api;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

api.get("/api/agentic/offers", (c) => c.json({ offers: OFFERS }));

api.get("/api/agentic/capabilities", (c) => {
  return c.json({
    localMock: { available: true, execution: "local-deterministic" },
    merchantCatalogue: { available: true, execution: "local" },
    humanConfirmedAdyenSession: { available: true, execution: "Adyen TEST when configured" },
    realAgenticProvider: {
      available: false,
      status: "pilot-not-verifiable-in-test",
      reason: realAgenticUnavailableReason(),
    },
  });
});

api.post("/api/agentic/runs", async (c) => {
  const body = object(await c.req.json());
  const intent = String(body.intent ?? "").trim().slice(0, 1000);
  const mode = body.mode === "real" ? "real" : "mock";
  if (intent.length < 8) {
    return c.json({ error: "Describe the shopping intent in more detail." }, 400);
  }
  if (mode === "real") {
    context.repository.audit({
      appId: "agentic",
      correlationId: crypto.randomUUID(),
      action: "agentic.run",
      outcome: "blocked-unavailable",
      payload: { reason: realAgenticUnavailableReason() },
    });
    return c.json({
      error: realAgenticUnavailableReason(),
      status: "unavailable",
      calledExternalProvider: false,
    }, 501);
  }

  const run = runLocalAgenticMock(intent);
  const order = context.repository.createOrder({
    appId: "agentic",
    flow: "agentic-local-mock",
    amount: { value: run.selectedOffer.price, currency: run.selectedOffer.currency },
    metadata: {
      selectedOfferId: run.selectedOffer.id,
      intent,
      simulated: true,
    },
  });
  for (const step of run.steps) {
    context.repository.recordApiCall({
      appId: "agentic",
      correlationId: order.id,
      name: step.name,
      method: "LOCAL",
      endpoint: `${step.system}://agentic/${step.name.toLowerCase().replaceAll(" ", "-")}`,
      status: step.status === "unavailable" ? 501 : 200,
      durationMs: step.status === "executed" ? 4 : 0,
      request: { intent },
      response: {
        ...step.payload,
        status: step.status,
        summary: step.summary,
      },
    });
  }
  context.repository.audit({
    appId: "agentic",
    correlationId: order.id,
    action: "agentic.run",
    outcome: "local-mock",
    payload: { selectedOfferId: run.selectedOffer.id, externalProviderCalled: false },
  });
  return c.json({ correlationId: order.id, run }, 201);
});

api.post("/api/agentic/runs/:id/checkout-session", async (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order || order.appId !== "agentic") return c.json({ error: "Agentic run not found." }, 404);
  if (order.flow !== "agentic-local-mock") {
    return c.json({ error: "Only a reviewed local mock offer can be handed to checkout." }, 409);
  }
  const selected = await selectedSecrets(context, c.req.raw);
  if (!selected.secrets.merchantAccount || !selected.secrets.clientKey) {
    return c.json({ error: "A merchant account and TEST client key are required." }, 409);
  }
  const addresses = buildCheckoutAddresses({ countryCode: "FR" });
  const request = {
    merchantAccount: selected.secrets.merchantAccount,
    amount: order.amount,
    reference: order.reference,
    countryCode: "FR",
    shopperLocale: "en-US",
    shopperReference: weeklyShopperReference(),
    shopperEmail: resolveShopperEmail(),
    lineItems: buildLineItems(order.amount),
    channel: "Web",
    returnUrl: `${context.config.publicOrigin}/?agenticRun=${order.id}`,
    billingAddress: addresses.billingAddress,
    deliveryAddress: {
      ...addresses.deliveryAddress,
      firstName: "Test",
      lastName: "Shopper",
    },
    ...sessionRiskFields("FR"),
  };
  const started = performance.now();
  try {
    const response = await new AdyenTestClient(selected.secrets).sessions(
      request,
      crypto.randomUUID(),
    );
    context.repository.recordApiCall({
      appId: "agentic",
      correlationId: order.id,
      name: "Human-confirmed Checkout API /sessions",
      method: "POST",
      endpoint: "https://checkout-test.adyen.com/v72/sessions",
      status: 200,
      durationMs: Math.round(performance.now() - started),
      request,
      response,
    });
    context.repository.createSession({
      orderId: order.id,
      kind: "human-confirmed-checkout",
      adyenSessionId: String(object(response).id ?? ""),
      state: "created",
      expiresAt: String(object(response).expiresAt ?? ""),
    });
    context.repository.updateOrder(order.id, { state: "payment_pending" });
    return c.json({
      correlationId: order.id,
      session: response,
      boundary: {
        agenticProviderCalled: false,
        adyenCheckoutTestCalled: true,
        humanConfirmationRequired: true,
      },
    }, 201);
  } catch (error) {
    context.repository.recordApiCall({
      appId: "agentic",
      correlationId: order.id,
      name: "Human-confirmed Checkout API /sessions",
      method: "POST",
      endpoint: "https://checkout-test.adyen.com/v72/sessions",
      status: 500,
      durationMs: Math.round(performance.now() - started),
      request,
      response: {},
      error: error instanceof Error ? error.message : "Request failed.",
    });
    throw error;
  }
});

api.get("/api/agentic/runs", (c) => {
  const runs = context.repository.listOrders("agentic").map((order) => ({
    ...order,
    timeline: context.repository.timeline(order.id),
  }));
  return c.json({ runs });
});

async function webhookProfiles(): Promise<ProfileSecrets[]> {
  const profiles = await context.profiles.listPublic();
  const result: ProfileSecrets[] = [];
  for (const profile of profiles) {
    const secrets = await context.profiles.getSecrets(profile.id);
    if (secrets?.hmacKey) result.push(secrets);
  }
  return result;
}

api.post("/webhook", async (c) => {
  const payload = object(await c.req.json());
  const notificationItems = Array.isArray(payload.notificationItems)
    ? payload.notificationItems
    : [];
  const secrets = await webhookProfiles();
  let invalid = false;
  for (const wrapper of notificationItems) {
    const item = object(object(wrapper).NotificationRequestItem) as StandardWebhookItem;
    let hmacValid = false;
    for (const profile of secrets) {
      if (await verifyStandardHmac(item, profile.hmacKey)) {
        hmacValid = true;
        break;
      }
    }
    const order = context.repository.getOrderByReference(String(item.merchantReference ?? ""));
    const correlationId = order?.id ?? String(item.merchantReference ?? "unmatched");
    const eventType = String(item.eventCode ?? "UNKNOWN");
    context.repository.recordWebhook({
      appId: "agentic",
      dedupeKey: [item.pspReference, eventType, item.success].join(":"),
      correlationId,
      eventType,
      pspReference: item.pspReference,
      hmacValid,
      payload: sanitize(item),
    });
    if (!hmacValid) invalid = true;
    if (hmacValid && order && eventType === "AUTHORISATION") {
      context.repository.updateOrder(order.id, {
        state: String(item.success).toLowerCase() === "true" ? "paid" : "open",
        paidValue: String(item.success).toLowerCase() === "true" ? order.amount.value : 0,
      });
    }
  }
  if (invalid || !notificationItems.length) {
    return c.json({ error: "Invalid, missing or unsupported webhook HMAC." }, 401);
  }
  return c.text("[accepted]", 202);
});

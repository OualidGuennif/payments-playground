import { createPlatformContext, selectedSecrets } from "@suite/platform/base-api.ts";
import { AdyenTestClient } from "@suite/platform/adyen.ts";
import { buildCheckoutAddresses, SUPPORTED_COUNTRY_CODES } from "@suite/platform/addresses.ts";
import { type StandardWebhookItem, verifyStandardHmac } from "@suite/platform/hmac.ts";
import {
  actionPermissions,
  lifecycleSourceAttempt,
  PAYMENT_METHOD_CAPABILITIES,
} from "@suite/platform/lifecycle.ts";
import { PAYMENT_METHOD_RULES } from "@suite/platform/payment-methods.ts";
import { rejectRawCardData, sanitize } from "@suite/platform/sanitize.ts";
import { requestOrigin } from "@suite/platform/security.ts";
import {
  buildLineItems,
  paymentsRiskFields,
  resolveShopperEmail,
  sessionRiskFields,
  splitsCardFundingSources,
} from "@suite/platform/sessionContext.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import {
  mapAdyenResultCode,
  type OrderResolution,
  type OrderResolutionInput,
  resolveOrder,
} from "@suite/platform/state-machine.ts";
import type {
  Amount,
  AttemptAggregate,
  JsonValue,
  OrderAggregate,
  ProfileSecrets,
} from "@suite/platform/types.ts";

const context = createPlatformContext("digital");
export const api = context.api;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * checkoutAttemptId is already carried inside sdkData, so forwarding it as a
 * sibling field duplicates the analytics payload, the legacy playground
 * stripped it for the same reason.
 */
function sanitizePaymentMethod(paymentMethod: Record<string, unknown>) {
  const { checkoutAttemptId: _dropped, ...rest } = paymentMethod;
  return rest;
}

function amountFrom(value: unknown, defaultCurrency = "EUR"): Amount {
  const candidate = object(value);
  const amount = Number(candidate.value);
  const currency = String(candidate.currency ?? defaultCurrency).toUpperCase();
  if (!Number.isInteger(amount) || amount < 1 || amount > 100_000_000) {
    throw new Error("Amount must be an integer between 1 and 100000000 minor units.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be an ISO 4217 code.");
  return { value: amount, currency };
}

/**
 * Adyen documents shopperConversionId as an opaque unique id, so a UUID is
 * kept as-is and anything else is replaced rather than trusted, the client
 * only ever echoes back a value this server minted.
 */
function conversionIdFrom(value: unknown): string {
  return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID();
}

function countryFrom(value: unknown): string {
  const country = String(value ?? "FR").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("countryCode must be ISO alpha-2.");
  return country;
}

function resultField(result: unknown, field: string): unknown {
  return object(result)[field];
}

function responseStatus(error: unknown): number {
  const candidate = object(error);
  const status = Number(candidate.statusCode ?? candidate.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

async function recordedCall<T>(input: {
  correlationId: string;
  name: string;
  method?: string;
  endpoint: string;
  request: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  const started = performance.now();
  try {
    const response = await input.execute();
    context.repository.recordApiCall({
      appId: "digital",
      correlationId: input.correlationId,
      name: input.name,
      method: input.method ?? "POST",
      endpoint: input.endpoint,
      status: 200,
      durationMs: Math.round(performance.now() - started),
      request: input.request,
      response,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Adyen API request failed.";
    context.repository.recordApiCall({
      appId: "digital",
      correlationId: input.correlationId,
      name: input.name,
      method: input.method ?? "POST",
      endpoint: input.endpoint,
      status: responseStatus(error),
      durationMs: Math.round(performance.now() - started),
      request: input.request,
      response: {},
      error: message,
    });
    throw error;
  }
}

/** Re-derives the order from its attempts (plus any terminal event) and stores it. */
function resolveAndStore(
  order: OrderAggregate,
  events: Pick<
    OrderResolutionInput,
    "expiresAt" | "linkStatus" | "orderClosedWebhook" | "modificationWebhook"
  > = {},
): OrderResolution {
  const resolution = resolveOrder({
    currentState: order.state,
    totalValue: order.amount.value,
    expiresAt: order.expiresAt,
    ...events,
    attempts: context.repository.listAttempts(order.id).map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      value: attempt.amount.value,
      pspReference: attempt.pspReference,
    })),
  });
  context.repository.updateOrder(order.id, {
    state: resolution.state,
    paidValue: resolution.paidValue,
  });
  return resolution;
}

/**
 * Writes one Adyen payment result onto its attempt and re-resolves the order.
 * /payments, /payments/details and MIT all end here, so a 3DS or redirect
 * outcome reaches the Back Office the same way a frictionless one does.
 */
function settleAttempt(
  order: OrderAggregate,
  attempt: AttemptAggregate,
  result: unknown,
): OrderResolution {
  const state = mapAdyenResultCode(String(resultField(result, "resultCode") ?? ""));
  const updated = context.repository.updateAttempt(attempt.id, {
    state,
    pspReference: String(resultField(result, "pspReference") ?? "") || undefined,
    refusalReason: String(resultField(result, "refusalReason") ?? "") || undefined,
  });
  if (state === "authorised") {
    context.repository.recordPaymentPart({
      orderId: order.id,
      attemptId: attempt.id,
      pspReference: updated.pspReference,
      amount: updated.amount,
      state: "authorised",
    });
  }
  return resolveAndStore(order);
}

function permissionsFor(order: OrderAggregate, attempts: AttemptAggregate[]) {
  const paymentMethod = (lifecycleSourceAttempt(attempts) ??
    attempts.find((attempt) => attempt.paymentMethod))?.paymentMethod;
  return actionPermissions(order.state, paymentMethod, order.paidValue);
}

function requestBase(input: {
  body: Record<string, unknown>;
  secrets: ProfileSecrets;
  order: OrderAggregate;
  origin: string;
  // "payments" gets merchantRiskIndicator too; /sessions and /paymentLinks
  // reject it outright ("contains the following unknown fields").
  context: "sessions" | "payments" | "paymentLinks";
}): Record<string, unknown> {
  const countryCode = countryFrom(input.body.countryCode);
  const addresses = buildCheckoutAddresses({
    countryCode,
    billingAddress: input.body.billingAddress,
    deliveryAddress: input.body.deliveryAddress,
  });
  const billingAddress = addresses.billingAddress;
  // /sessions and /payments accept a recipient name inside deliveryAddress;
  // /paymentLinks validates it against a plain address schema and rejects
  // them ("Structure of address contains the following unknown fields:
  // [firstName, lastName]"), so it only gets the postal fields.
  const deliveryAddress = input.context === "paymentLinks" ? addresses.deliveryAddress : {
    ...addresses.deliveryAddress,
    firstName: String(input.body.firstName ?? "Test"),
    lastName: String(input.body.lastName ?? "Shopper"),
  };
  return {
    amount: input.order.amount,
    reference: input.order.reference,
    merchantAccount: input.secrets.merchantAccount,
    // Required by /sessions and /payments, /payments rejects the request
    // outright ("Required field 'channel' is not provided") without it. Left
    // off /paymentLinks, whose request schema has no channel field and
    // rejects unknown ones.
    ...(input.context === "paymentLinks" ? {} : { channel: "Web" }),
    countryCode,
    shopperLocale: String(input.body.shopperLocale ?? "en-US"),
    shopperReference: weeklyShopperReference(),
    shopperEmail: resolveShopperEmail(input.body.shopperEmail),
    // Required for line-item-aware methods (Klarna and other BNPL) to be
    // considered eligible at all, without it they're silently excluded.
    lineItems: buildLineItems(input.order.amount),
    returnUrl: `${input.origin}/result?orderId=${input.order.id}`,
    billingAddress,
    deliveryAddress,
    // Lets the shopper opt in to saving the card (shown as a checkbox in the
    // Card component) so the "save card" / one-click flow can be previewed ,
    // Sessions-only: the Advanced flow's equivalent is the client-side
    // enableStoreDetails config plus a per-payment storePaymentMethod flag.
    ...(input.context === "sessions"
      ? { storePaymentMethodMode: "askForConsent", recurringProcessingModel: "CardOnFile" }
      : {}),
    ...(input.context === "payments"
      ? paymentsRiskFields(billingAddress, deliveryAddress)
      : sessionRiskFields(countryCode)),
  };
}

async function profileClient(request: Request) {
  const selected = await selectedSecrets(context, request);
  if (!selected.secrets.merchantAccount) {
    throw new Error("The selected TEST profile has no merchant account.");
  }
  return { ...selected, client: new AdyenTestClient(selected.secrets) };
}

api.get("/api/digital/config", (c) => {
  return c.json({
    countries: SUPPORTED_COUNTRY_CODES,
    paymentMethodRules: PAYMENT_METHOD_RULES,
    capabilities: PAYMENT_METHOD_CAPABILITIES,
  });
});

api.get("/api/digital/orders", (c) => {
  const orders = context.repository.listOrders("digital").map((order) => {
    const attempts = context.repository.listAttempts(order.id);
    return { ...order, attempts, permissions: permissionsFor(order, attempts) };
  });
  return c.json({ orders });
});

api.get("/api/digital/orders/:id", (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "Order not found." }, 404);
  const attempts = context.repository.listAttempts(order.id);
  return c.json({
    order,
    attempts,
    timeline: context.repository.timeline(order.id),
    permissions: permissionsFor(order, attempts),
  });
});

api.post("/api/digital/sessions", async (c) => {
  const body = object(await c.req.json());
  const amount = amountFrom(body.amount);
  const { client, secrets, id: profileId } = await profileClient(c.req.raw);
  const order = context.repository.createOrder({
    appId: "digital",
    flow: String(body.flow ?? "sessions-dropin"),
    amount,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    metadata: { profileId },
  });
  const idempotencyKey = crypto.randomUUID();
  const origin = requestOrigin(c.req.raw, context.config.publicOrigin);
  const request = {
    ...requestBase({ body, secrets, order, origin, context: "sessions" }),
    ...(body.installments === true
      ? { installmentOptions: { card: { values: [2, 3, 4], preselectedValue: 2 } } }
      : {}),
    ...(Array.isArray(body.allowedPaymentMethods)
      ? { allowedPaymentMethods: body.allowedPaymentMethods }
      : {}),
  };
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API /sessions",
    endpoint: "https://checkout-test.adyen.com/v72/sessions",
    request,
    execute: () => client.sessions(request, idempotencyKey),
  });
  context.repository.createSession({
    orderId: order.id,
    kind: String(body.flow ?? "sessions-dropin"),
    adyenSessionId: String(resultField(result, "id") ?? ""),
    state: "created",
    expiresAt: String(resultField(result, "expiresAt") ?? order.expiresAt),
  });
  context.repository.audit({
    appId: "digital",
    correlationId: order.id,
    action: "session.create",
    outcome: "success",
    payload: { profileId, idempotencyKey },
  });
  return c.json({
    correlationId: order.id,
    order,
    session: result,
  }, 201);
});

interface SessionPayment {
  pspReference: string;
  resultCode: string;
  amount?: Amount;
  paymentMethod?: string;
}

function sessionPayments(result: unknown): SessionPayment[] {
  const payments = object(result).payments;
  if (!Array.isArray(payments)) return [];
  return payments.map(object).filter((payment) => typeof payment.pspReference === "string").map(
    (payment) => {
      const amount = object(payment.amount);
      return {
        pspReference: String(payment.pspReference),
        resultCode: String(payment.resultCode ?? ""),
        amount: typeof amount.value === "number" && typeof amount.currency === "string"
          ? { value: amount.value, currency: amount.currency }
          : undefined,
        paymentMethod: typeof object(payment.paymentMethod).type === "string"
          ? String(object(payment.paymentMethod).type)
          : undefined,
      };
    },
  );
}

// Adyen Web runs the whole Sessions payment client-side, so without a webhook
// this server never learned how it ended and every Sessions order stayed
// "open". The sessionResult Adyen Web hands back on completion is the key to
// GET /sessions/{id}, which answers with the PSP reference of each payment.
api.post("/api/digital/sessions/:orderId/result", async (c) => {
  const order = context.repository.getOrder(c.req.param("orderId"));
  const sessionId = order ? context.repository.findAdyenSessionId(order.id) : undefined;
  if (!order || !sessionId) return c.json({ error: "Unknown Sessions order." }, 404);
  const body = object(await c.req.json());
  const sessionResult = typeof body.sessionResult === "string" ? body.sessionResult : "";
  if (!sessionResult) return c.json({ error: "sessionResult is required." }, 400);
  const { client } = await profileClient(c.req.raw);
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API GET /sessions/{id}",
    method: "GET",
    endpoint: `https://checkout-test.adyen.com/v72/sessions/${sessionId}`,
    request: { sessionId, sessionResult },
    execute: () => client.getSessionResult(sessionId, sessionResult),
  });
  const attempts = context.repository.listAttempts(order.id);
  for (const payment of sessionPayments(result)) {
    const state = mapAdyenResultCode(payment.resultCode);
    const amount = payment.amount ?? order.amount;
    const existing = attempts.find((attempt) => attempt.pspReference === payment.pspReference);
    const attempt = existing
      ? context.repository.updateAttempt(existing.id, { state })
      : context.repository.createAttempt({
        orderId: order.id,
        amount,
        state,
        paymentMethod: payment.paymentMethod,
        pspReference: payment.pspReference,
      });
    if (state === "authorised") {
      context.repository.recordPaymentPart({
        orderId: order.id,
        attemptId: attempt.id,
        pspReference: payment.pspReference,
        amount,
        state: "authorised",
      });
    }
  }
  return c.json({ correlationId: order.id, result, resolution: resolveAndStore(order) });
});

api.post("/api/digital/payment-methods", async (c) => {
  const body = object(await c.req.json());
  const amount = amountFrom(body.amount);
  const countryCode = countryFrom(body.countryCode);
  const { client, secrets } = await profileClient(c.req.raw);
  const correlationId = String(body.correlationId ?? crypto.randomUUID());
  // One id per Advanced-flow checkout, minted here and echoed back so the
  // /payments call that follows can repeat it, that pairing is the whole
  // point of the field, and it is what Adyen's checkout conversion insights
  // key on. Only /paymentMethods and /payments accept it; /sessions and
  // /paymentLinks reject it as an unknown field.
  const shopperConversionId = conversionIdFrom(body.shopperConversionId);
  const request = {
    merchantAccount: secrets.merchantAccount,
    amount,
    countryCode,
    channel: "Web",
    shopperLocale: String(body.shopperLocale ?? "en-US"),
    shopperEmail: resolveShopperEmail(body.shopperEmail),
    shopperReference: weeklyShopperReference(),
    shopperConversionId,
    splitCardFundingSources: splitsCardFundingSources(countryCode),
  };
  const result = await recordedCall({
    correlationId,
    name: "Checkout API /paymentMethods",
    endpoint: "https://checkout-test.adyen.com/v72/paymentMethods",
    request,
    execute: () => client.paymentMethods(request),
  });
  return c.json({ correlationId, shopperConversionId, paymentMethodsResponse: result });
});

api.post("/api/digital/payments", async (c) => {
  const body = object(await c.req.json());
  rejectRawCardData(body.paymentMethod);
  const amount = amountFrom(body.amount);
  const { client, secrets, id: profileId } = await profileClient(c.req.raw);
  const existingOrder = typeof body.orderId === "string"
    ? context.repository.getOrder(body.orderId)
    : undefined;
  const order = existingOrder ?? context.repository.createOrder({
    appId: "digital",
    flow: String(body.flow ?? "advanced-dropin"),
    amount,
    metadata: { profileId },
  });
  const paymentMethod = sanitizePaymentMethod(object(body.paymentMethod));
  const isStoredPaymentMethod = Boolean(paymentMethod.storedPaymentMethodId);
  const attempt = context.repository.createAttempt({
    orderId: order.id,
    amount,
    state: "created",
    paymentMethod: String(paymentMethod.type ?? "unknown"),
  });
  const idempotencyKey = crypto.randomUUID();
  const origin = requestOrigin(c.req.raw, context.config.publicOrigin);
  const request = {
    ...requestBase({ body, secrets, order, origin, context: "payments" }),
    paymentMethod,
    browserInfo: body.browserInfo,
    origin,
    // Paying with a token, or asking to store one, is a card-on-file
    // transaction, the legacy playground derived both fields from the payload
    // instead of trusting the client to label it correctly.
    shopperInteraction: body.shopperInteraction ??
      (isStoredPaymentMethod ? "ContAuth" : "Ecommerce"),
    ...(body.recurringProcessingModel
      ? { recurringProcessingModel: body.recurringProcessingModel }
      : isStoredPaymentMethod || body.storePaymentMethod
      ? { recurringProcessingModel: "CardOnFile" }
      : {}),
    // A stored method is already on file; re-storing it is rejected.
    ...(body.storePaymentMethod && !isStoredPaymentMethod ? { storePaymentMethod: true } : {}),
    ...(body.order && typeof body.order === "object" ? { order: body.order } : {}),
    // Repeats the id minted by the /paymentMethods call that opened this
    // checkout, which is what links the two requests into one conversion.
    // Absent for flows that never listed payment methods (MIT), where a
    // freshly invented id would link nothing.
    ...(typeof body.shopperConversionId === "string"
      ? { shopperConversionId: conversionIdFrom(body.shopperConversionId) }
      : {}),
  };
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API /payments",
    endpoint: "https://checkout-test.adyen.com/v72/payments",
    request,
    execute: () => client.payments(request, idempotencyKey),
  });
  return c.json({
    correlationId: order.id,
    attemptId: attempt.id,
    result,
    resolution: settleAttempt(order, attempt, result),
  }, 201);
});

api.post("/api/digital/payments/details", async (c) => {
  const body = object(await c.req.json());
  const correlationId = String(body.correlationId ?? "");
  const order = context.repository.getOrder(correlationId);
  if (!order) return c.json({ error: "Unknown correlationId." }, 404);
  const { client } = await profileClient(c.req.raw);
  const request = {
    details: object(body.details),
    ...(typeof body.paymentData === "string" ? { paymentData: body.paymentData } : {}),
  };
  const result = await recordedCall({
    correlationId,
    name: "Checkout API /payments/details",
    endpoint: "https://checkout-test.adyen.com/v72/payments/details",
    request,
    execute: () => client.paymentDetails(request, crypto.randomUUID()),
  });
  // The attempt /payments left waiting on 3DS or a redirect.
  const attempt = context.repository.listAttempts(order.id).findLast((item) =>
    item.state === "pending" || item.state === "created"
  );
  const resolution = attempt ? settleAttempt(order, attempt, result) : undefined;
  return c.json({ correlationId, result, resolution });
});

api.post("/api/digital/payment-links", async (c) => {
  const body = object(await c.req.json());
  const amount = amountFrom(body.amount);
  const { client, secrets, id: profileId } = await profileClient(c.req.raw);
  const validityHours = Math.min(
    Math.max(Number(body.validityHours ?? PAYMENT_METHOD_RULES.payByLinkValidityHours), 1),
    PAYMENT_METHOD_RULES.maximumPayByLinkValidityDays * 24,
  );
  const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000).toISOString();
  const order = context.repository.createOrder({
    appId: "digital",
    flow: "pay-by-link",
    amount,
    expiresAt,
    metadata: { profileId, validityHours },
  });
  const origin = requestOrigin(c.req.raw, context.config.publicOrigin);
  const request = {
    ...requestBase({ body, secrets, order, origin, context: "paymentLinks" }),
    expiresAt,
    description: String(body.description ?? "Adyen TEST playground order").slice(0, 280),
    reusable: Boolean(body.reusable),
    requiredShopperFields: Array.isArray(body.requiredShopperFields)
      ? body.requiredShopperFields
      : ["shopperEmail", "billingAddress", "deliveryAddress"],
  };
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API /paymentLinks",
    endpoint: "https://checkout-test.adyen.com/v72/paymentLinks",
    request,
    execute: () => client.createPaymentLink(request, crypto.randomUUID()),
  });
  const linkId = String(resultField(result, "id") ?? "");
  const updated = context.repository.updateOrder(order.id, {
    paymentLinkId: linkId || undefined,
    expiresAt: String(resultField(result, "expiresAt") ?? expiresAt),
  });
  return c.json({ correlationId: order.id, order: updated, paymentLink: result }, 201);
});

api.get("/api/digital/payment-links/:orderId", async (c) => {
  const order = context.repository.getOrder(c.req.param("orderId"));
  if (!order?.paymentLinkId) return c.json({ error: "Payment link not found." }, 404);
  const { client } = await profileClient(c.req.raw);
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API GET /paymentLinks/{id}",
    method: "GET",
    endpoint: `https://checkout-test.adyen.com/v72/paymentLinks/${order.paymentLinkId}`,
    request: { linkId: order.paymentLinkId },
    execute: () => client.getPaymentLink(order.paymentLinkId!),
  });
  const linkStatus = String(resultField(result, "status") ?? "active") as
    | "active"
    | "expired"
    | "completed"
    | "paymentPending";
  const resolution = resolveAndStore(order, {
    expiresAt: String(resultField(result, "expiresAt") ?? order.expiresAt),
    linkStatus,
  });
  return c.json({ paymentLink: result, resolution });
});

api.post("/api/digital/partial-orders", async (c) => {
  const body = object(await c.req.json());
  const amount = amountFrom(body.amount);
  const { client, secrets, id: profileId } = await profileClient(c.req.raw);
  const expiresAt = new Date(
    Date.now() + PAYMENT_METHOD_RULES.partialOrderValidityHours * 60 * 60 * 1000,
  ).toISOString();
  const order = context.repository.createOrder({
    appId: "digital",
    flow: "partial-payment",
    amount,
    expiresAt,
    metadata: { profileId },
  });
  const request = {
    amount,
    reference: order.reference,
    merchantAccount: secrets.merchantAccount,
    expiresAt,
  };
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API /orders",
    endpoint: "https://checkout-test.adyen.com/v72/orders",
    request,
    execute: () => client.createOrder(request, crypto.randomUUID()),
  });
  return c.json({ correlationId: order.id, order, adyenOrder: result }, 201);
});

api.post("/api/digital/mit", async (c) => {
  const body = object(await c.req.json());
  rejectRawCardData(body);
  const token = String(body.storedPaymentMethodId ?? "");
  const shopperReference = String(body.shopperReference ?? "");
  if (!token || shopperReference.length < 3) {
    return c.json({
      error: "storedPaymentMethodId and a non-PII shopperReference are required.",
    }, 400);
  }
  const amount = amountFrom(body.amount);
  const { client, secrets, id: profileId } = await profileClient(c.req.raw);
  const order = context.repository.createOrder({
    appId: "digital",
    flow: "mit",
    amount,
    metadata: { profileId },
  });
  const attempt = context.repository.createAttempt({
    orderId: order.id,
    amount,
    state: "created",
    paymentMethod: "storedPaymentMethod",
  });
  const request = {
    amount,
    reference: order.reference,
    merchantAccount: secrets.merchantAccount,
    // /payments requires channel on every call, MIT included.
    channel: "Web",
    paymentMethod: { storedPaymentMethodId: token },
    shopperReference,
    shopperInteraction: "ContAuth",
    recurringProcessingModel: body.recurringProcessingModel === "Subscription"
      ? "Subscription"
      : "UnscheduledCardOnFile",
  };
  const result = await recordedCall({
    correlationId: order.id,
    name: "MIT Checkout API /payments",
    endpoint: "https://checkout-test.adyen.com/v72/payments",
    request,
    execute: () => client.payments(request, crypto.randomUUID()),
  });
  const resolution = settleAttempt(order, attempt, result);
  return c.json({ correlationId: order.id, result, resolution }, 201);
});

api.post("/api/digital/api-only", async (c) => {
  const body = object(await c.req.json());
  rejectRawCardData(body);
  const paymentMethod = object(body.paymentMethod);
  if (
    !Object.values(paymentMethod).some((value) =>
      typeof value === "string" && (value.startsWith("adyenjs_") || value.length > 12)
    )
  ) {
    return c.json({
      error:
        "API Only accepts Adyen-encrypted component values or a stored payment method token, never raw card data.",
    }, 400);
  }
  // Reuse the Advanced Flow contract after the explicit PCI boundary check.
  const clonedHeaders = new Headers(c.req.raw.headers);
  const proxied = new Request(new URL("/api/digital/payments", c.req.url), {
    method: "POST",
    headers: clonedHeaders,
    body: JSON.stringify({ ...body, flow: "api-only-pci" }),
  });
  return await api.fetch(proxied);
});

api.post("/api/digital/orders/:id/actions/:action", async (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "Order not found." }, 404);
  const action = c.req.param("action");
  if (!["capture", "cancel", "refund"].includes(action)) {
    return c.json({ error: "Unsupported lifecycle action." }, 400);
  }
  const sourceAttempt = lifecycleSourceAttempt(context.repository.listAttempts(order.id));
  if (!sourceAttempt?.pspReference) {
    return c.json({ error: "No authorised payment is available." }, 409);
  }
  const permissions = actionPermissions(
    order.state,
    sourceAttempt.paymentMethod,
    order.paidValue,
  );
  const permission = permissions[action as keyof typeof permissions];
  if (!permission.allowed) return c.json({ error: permission.reason, permissions }, 409);

  const body = object(await c.req.json().catch(() => ({})));
  const idempotencyKey = String(c.req.header("idempotency-key") ?? crypto.randomUUID()).slice(
    0,
    64,
  );
  const actionRecord = context.repository.recordAction({
    appId: "digital",
    orderId: order.id,
    correlationId: order.id,
    action,
    state: "received",
    idempotencyKey,
    payload: body,
  });
  if (actionRecord.duplicate) {
    return c.json({ duplicate: true, actionId: actionRecord.id }, 200);
  }
  const { client, secrets } = await profileClient(c.req.raw);
  const request = {
    merchantAccount: secrets.merchantAccount,
    reference: `${action}-${order.reference}`.slice(0, 80),
    ...(action !== "cancel"
      ? { amount: body.amount ? amountFrom(body.amount, order.amount.currency) : order.amount }
      : {}),
  };
  const result = await recordedCall({
    correlationId: order.id,
    name: `Checkout API lifecycle ${action}`,
    endpoint:
      `https://checkout-test.adyen.com/v72/payments/${sourceAttempt.pspReference}/${action}s`,
    request,
    execute: () => {
      if (action === "capture") {
        return client.capture(sourceAttempt.pspReference!, request, idempotencyKey);
      }
      if (action === "cancel") {
        return client.cancel(sourceAttempt.pspReference!, request, idempotencyKey);
      }
      return client.refund(sourceAttempt.pspReference!, request, idempotencyKey);
    },
  });
  return c.json({ actionId: actionRecord.id, result }, 202);
});

async function hmacSecrets(): Promise<ProfileSecrets[]> {
  const profiles = await context.profiles.listPublic();
  const values: ProfileSecrets[] = [];
  for (const profile of profiles) {
    const secrets = await context.profiles.getSecrets(profile.id);
    if (secrets?.hmacKey) values.push(secrets);
  }
  return values;
}

function webhookItems(payload: unknown): StandardWebhookItem[] {
  const root = object(payload);
  if (!Array.isArray(root.notificationItems)) return [root as StandardWebhookItem];
  return root.notificationItems.map((entry) =>
    object(object(entry).NotificationRequestItem) as StandardWebhookItem
  );
}

function correlateWebhook(item: StandardWebhookItem): OrderAggregate | undefined {
  const additional = object(item.additionalData);
  const linkId = String(additional.paymentLinkId ?? "");
  if (linkId) {
    const byLink = context.repository.findOrderByPaymentLinkId(linkId);
    if (byLink) return byLink;
  }
  const merchantReference = String(item.merchantReference ?? "");
  if (merchantReference) {
    const byReference = context.repository.getOrderByReference(merchantReference);
    if (byReference) return byReference;
  }
  // CAPTURE, CANCELLATION and REFUND carry the reference this server gave the
  // modification ("capture-<order>"), so their payment is found through the
  // original PSP reference instead.
  for (const reference of [item.originalReference, item.pspReference]) {
    if (!reference) continue;
    const byPsp = context.repository.findOrderByPspReference(String(reference));
    if (byPsp) return byPsp;
  }
  return undefined;
}

const MODIFICATION_EVENTS: Record<string, "capture" | "cancel"> = {
  CAPTURE: "capture",
  CANCELLATION: "cancel",
};

api.post("/webhook", async (c) => {
  const payload = await c.req.json();
  const secrets = await hmacSecrets();
  const items = webhookItems(payload);
  let invalid = false;

  for (const item of items) {
    let hmacValid = false;
    for (const profile of secrets) {
      if (await verifyStandardHmac(item, profile.hmacKey)) {
        hmacValid = true;
        break;
      }
    }
    const order = correlateWebhook(item);
    const correlationId = order?.id ?? String(item.merchantReference ?? "unmatched");
    const eventType = String(item.eventCode ?? object(payload).type ?? "UNKNOWN");
    const dedupeKey = [
      item.pspReference,
      item.originalReference,
      eventType,
      item.success,
    ].join(":");
    context.repository.recordWebhook({
      appId: "digital",
      dedupeKey,
      correlationId,
      eventType,
      pspReference: item.pspReference,
      hmacValid,
      payload: sanitize(item),
    });

    if (!hmacValid) {
      invalid = true;
      continue;
    }
    if (!order) continue;

    const success = String(item.success).toLowerCase() === "true";
    if (eventType === "AUTHORISATION") {
      let attempt = context.repository.listAttempts(order.id).find((value) =>
        value.pspReference === item.pspReference
      );
      if (!attempt) {
        attempt = context.repository.createAttempt({
          orderId: order.id,
          amount: {
            value: Number(item.amount?.value ?? order.amount.value),
            currency: String(item.amount?.currency ?? order.amount.currency),
          },
          paymentMethod: String(item.paymentMethod ?? "unknown"),
          pspReference: item.pspReference,
          state: success ? "authorised" : "refused",
          refusalReason: success ? undefined : String(item.reason ?? "Refused"),
        });
      } else {
        context.repository.updateAttempt(attempt.id, {
          state: success ? "authorised" : "refused",
          pspReference: item.pspReference,
          refusalReason: success ? undefined : String(item.reason ?? "Refused"),
        });
      }
      if (success) {
        context.repository.recordPaymentPart({
          orderId: order.id,
          attemptId: attempt.id,
          pspReference: item.pspReference,
          amount: {
            value: Number(item.amount?.value ?? order.amount.value),
            currency: String(item.amount?.currency ?? order.amount.currency),
          },
          state: "authorised",
        });
      }
    }

    const modification = MODIFICATION_EVENTS[eventType];
    resolveAndStore(order, {
      orderClosedWebhook: eventType === "ORDER_CLOSED" ? { success } : undefined,
      modificationWebhook: modification ? { kind: modification, success } : undefined,
    });
  }

  if (invalid) return c.json({ error: "Invalid or missing HMAC signature." }, 401);
  return c.text("[accepted]", 202);
});

api.get("/api/digital/webhooks/:correlationId", (c) => {
  const entries = context.repository.timeline(c.req.param("correlationId")).filter((entry) =>
    entry.kind === "webhook"
  );
  return c.json({
    waiting: entries.length === 0,
    entries: entries as unknown as JsonValue,
  });
});

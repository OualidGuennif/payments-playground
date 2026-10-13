import { createPlatformContext, selectedSecrets } from "@suite/platform/base-api.ts";
import { AdyenTestClient } from "@suite/platform/adyen.ts";
import { buildCheckoutAddresses, SUPPORTED_COUNTRY_CODES } from "@suite/platform/addresses.ts";
import { type StandardWebhookItem, verifyStandardHmac } from "@suite/platform/hmac.ts";
import { ledgerOf, reconcile } from "@suite/platform/modifications.ts";
import {
  actionPermissions,
  capabilitiesFor,
  lifecycleSourceAttempt,
  PAYMENT_METHOD_CAPABILITIES,
} from "@suite/platform/lifecycle.ts";
import { PAYMENT_METHOD_RULES } from "@suite/platform/payment-methods.ts";
import { rejectRawCardData, sanitize } from "@suite/platform/sanitize.ts";
import { requestOrigin, shopperIp } from "@suite/platform/security.ts";
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

// What a stored attempt state reads as for a shopper, when /result is reloaded.
const RESULT_CODE_FOR_STATE: Record<string, string> = {
  authorised: "Authorised",
  refused: "Refused",
  pending: "Pending",
  cancelled: "Cancelled",
  error: "Error",
};

// What Adyen Web puts in state.data beside paymentMethod and /payments accepts
// (checked against PaymentRequest in api-library 32). Dropping them lost the
// shopper's installment choice, Brazil's CPF and the device fingerprint.
// Addresses and shopperEmail are handled by requestBase.
const FORWARDED_STATE_DATA = [
  "riskData",
  "installments",
  "socialSecurityNumber",
  "shopperName",
  "telephoneNumber",
  "dateOfBirth",
] as const;

function forwardedStateData(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    FORWARDED_STATE_DATA.filter((field) => body[field] !== undefined).map((field) => [
      field,
      body[field],
    ]),
  );
}

/**
 * What was captured, refunded and cancelled on the order's authorised
 * payment, and what can be done next. The totals come from HMAC-valid
 * webhooks; a request Adyen answered "received" is pending until its own
 * webhook arrives.
 */
function lifecycleFor(order: OrderAggregate, attempts: AttemptAggregate[]) {
  const source = lifecycleSourceAttempt(attempts);
  const paymentMethod = (source ?? attempts.find((attempt) => attempt.paymentMethod))
    ?.paymentMethod;
  const modifications = reconcile(
    context.repository.listActions(order.id),
    context.repository.modificationEvents(order.id),
  );
  const settled = ledgerOf(source?.amount.value ?? 0, modifications);
  // A method captured on authorisation never sees a CAPTURE webhook: what is
  // authorised is captured.
  const ledger = capabilitiesFor(paymentMethod).automaticCapture && !settled.cancelled
    ? { ...settled, captured: settled.authorised }
    : settled;
  return {
    ledger,
    modifications,
    capabilities: capabilitiesFor(paymentMethod),
    permissions: actionPermissions(order.state, paymentMethod, ledger),
  };
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
  // Only /sessions gets a recipient name inside deliveryAddress. /payments
  // sends the postal fields only, by the owner's choice (2026-10-13), even
  // when Adyen Web's state.data supplied names. /paymentLinks validates a
  // plain address schema and rejects them ("Structure of address contains
  // the following unknown fields: [firstName, lastName]").
  const { firstName: _firstName, lastName: _lastName, ...postalDelivery } =
    addresses.deliveryAddress;
  const deliveryAddress = input.context === "sessions"
    ? {
      ...postalDelivery,
      firstName: String(input.body.firstName ?? "Test"),
      lastName: String(input.body.lastName ?? "Shopper"),
    }
    : postalDelivery;
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
    return { ...order, attempts, ...lifecycleFor(order, attempts) };
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
    ...lifecycleFor(order, attempts),
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
  // Used by Adyen's risk checks, and required for Visa and JCB 3DS2 when
  // shopperEmail is missing. Taken from the connection, never the body.
  const ip = shopperIp(c.req.raw, c.env as Deno.ServeHandlerInfo | undefined);
  const request = {
    ...requestBase({ body, secrets, order, origin, context: "payments" }),
    ...forwardedStateData(body),
    paymentMethod,
    browserInfo: body.browserInfo,
    origin,
    ...(ip ? { shopperIP: ip } : {}),
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

// A redirect method (iDEAL, Klarna, a 3DS1 bank page...) sends the shopper
// back to /result with a redirectResult and nothing else had told this server
// how the payment ended. Submitting it to /payments/details settles the order,
// for Sessions too: the redirectResult carries the whole payment, so the
// call does not need the session. A reload must not submit it twice, so an
// order with nothing left waiting answers with what is already stored.
api.post("/api/digital/orders/:id/redirect-result", async (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "Order not found." }, 404);
  const body = object(await c.req.json());
  const redirectResult = typeof body.redirectResult === "string" ? body.redirectResult : "";
  if (!redirectResult) return c.json({ error: "redirectResult is required." }, 400);
  const attempts = context.repository.listAttempts(order.id);
  const waiting = attempts.findLast((item) => item.state === "pending" || item.state === "created");
  const settled = attempts.findLast((item) => item.pspReference && item.state !== "created");
  if (!waiting && settled) {
    return c.json({
      correlationId: order.id,
      alreadySettled: true,
      result: {
        resultCode: RESULT_CODE_FOR_STATE[settled.state],
        pspReference: settled.pspReference,
        paymentMethod: { type: settled.paymentMethod },
      },
      resolution: resolveAndStore(order),
    });
  }
  const { client } = await profileClient(c.req.raw);
  const request = { details: { redirectResult } };
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API /payments/details",
    endpoint: "https://checkout-test.adyen.com/v72/payments/details",
    request,
    execute: () => client.paymentDetails(request, crypto.randomUUID()),
  });
  const merchantReference = resultField(result, "merchantReference");
  if (typeof merchantReference === "string" && merchantReference !== order.reference) {
    return c.json({ error: "This redirect belongs to another order." }, 409);
  }
  // Sessions orders get their attempt from the session result, which a
  // redirect skips; this is the first time the server sees the payment.
  const attempt = waiting ?? context.repository.createAttempt({
    orderId: order.id,
    amount: order.amount,
    state: "created",
    paymentMethod: String(object(resultField(result, "paymentMethod")).type ?? "unknown"),
  });
  return c.json({
    correlationId: order.id,
    result,
    resolution: settleAttempt(order, attempt, result),
  });
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
  return await api.fetch(proxied, c.env);
});

// Capture, cancel or refund. Each request carries the Idempotency-Key the
// Back Office minted for that intent (Adyen keeps it 7 to 14 days and returns
// the first response to a retry), and this route stores it too: a key it has
// seen answers with what is known instead of reaching Adyen again. A request
// Adyen answered "received" blocks another of its kind until its webhook,
// the only source of the outcome, arrives.
api.post("/api/digital/orders/:id/actions/:action", async (c) => {
  const order = context.repository.getOrder(c.req.param("id"));
  if (!order) return c.json({ error: "Order not found." }, 404);
  const action = c.req.param("action");
  if (action !== "capture" && action !== "cancel" && action !== "refund") {
    return c.json({ error: "Unsupported lifecycle action." }, 400);
  }
  const idempotencyKey = String(c.req.header("idempotency-key") ?? crypto.randomUUID()).slice(
    0,
    64,
  );
  const known = context.repository.findAction(idempotencyKey);
  if (known) {
    if (known.state === "requested") {
      // Adyen's own answer to a duplicate still in flight (error code 704).
      return c.json({ error: "This request is already being processed." }, 409);
    }
    return c.json({ duplicate: true, request: known }, 200);
  }

  const attempts = context.repository.listAttempts(order.id);
  const sourceAttempt = lifecycleSourceAttempt(attempts);
  if (!sourceAttempt?.pspReference) {
    return c.json({ error: "No authorised payment is available." }, 409);
  }
  const { permissions } = lifecycleFor(order, attempts);
  const permission = permissions[action];
  if (!permission.allowed) return c.json({ error: permission.reason, permissions }, 409);

  const body = object(await c.req.json().catch(() => ({})));
  let amount: Amount | undefined;
  if (action !== "cancel") {
    const max = permission.maxValue ?? 0;
    const value = body.amount === undefined ? max : Number(object(body.amount).value);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      return c.json({ error: `The amount must be between 1 and ${max} minor units.` }, 400);
    }
    if (!permission.partial && value !== max) {
      return c.json({ error: `This payment method only takes the full ${action}.` }, 400);
    }
    amount = { value, currency: sourceAttempt.amount.currency };
  }

  const record = context.repository.recordAction({
    appId: "digital",
    orderId: order.id,
    correlationId: order.id,
    action,
    state: "requested",
    idempotencyKey,
    payload: amount ? { amount } : {},
  });
  if (record.duplicate) {
    return c.json({ error: "This request is already being processed." }, 409);
  }
  const { client, secrets } = await profileClient(c.req.raw);
  const request = {
    merchantAccount: secrets.merchantAccount,
    reference: `${action}-${order.reference}`.slice(0, 80),
    ...(amount ? { amount } : {}),
  };
  try {
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
    context.repository.updateAction(record.id, {
      state: "received",
      pspReference: String(resultField(result, "pspReference") ?? "") || undefined,
    });
    return c.json({ actionId: record.id, idempotencyKey, result }, 202);
  } catch (error) {
    context.repository.updateAction(record.id, {
      state: "rejected",
      reason: error instanceof Error ? error.message : "Adyen rejected the request.",
    });
    throw error;
  }
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

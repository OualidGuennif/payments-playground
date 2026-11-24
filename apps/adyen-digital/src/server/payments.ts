// Spec: knowledge/components/adyen-digital.md
// One /payments call, shared by the Advanced and API-only routes.
import { rejectRawCardData } from "@suite/platform/sanitize.ts";
import { requestOrigin, shopperIp } from "@suite/platform/security.ts";
import { status } from "elysia";
import { context, profileClient } from "./context.ts";
import { object, sanitizePaymentMethod, orderReference, amountFrom } from "./input.ts";
import { recordedCall, settleAttempt } from "./orders.ts";
import { buildPaymentRequest } from "./requests.ts";

/**
 * /payments for the Advanced flow, and for API only once its PCI boundary
 * check passed.
 */
export async function createPayment(
  body: Record<string, unknown>,
  http: Request,
  remoteAddress?: string,
  metadataFlow: "advanced" | "api-only" = "advanced",
) {
  rejectRawCardData(body.paymentMethod);
  const amount = amountFrom(body.amount);
  const { client, secrets, id: profileId } = await profileClient(http);
  const existingOrder =
    typeof body.orderId === "string" ? context.repository.getOrder(body.orderId) : undefined;
  const order =
    existingOrder ??
    context.repository.createOrder({
      appId: "digital",
      flow: String(body.flow ?? "advanced-dropin"),
      amount,
      metadata: { profileId },
    });
  // A payment into an Adyen order charges its share (a gift card's balance,
  // then the rest), not the whole order, and never more than the order.
  const adyenOrder = orderReference(body.order);
  if (
    adyenOrder &&
    (amount.currency !== order.amount.currency || amount.value > order.amount.value)
  ) {
    return status(400, { error: "A partial payment cannot exceed its order." });
  }
  const paymentMethod = sanitizePaymentMethod(object(body.paymentMethod));
  const attempt = context.repository.createAttempt({
    orderId: order.id,
    amount,
    state: "created",
    paymentMethod: String(paymentMethod.type ?? "unknown"),
  });
  const idempotencyKey = crypto.randomUUID();
  const origin = requestOrigin(http, context.config.publicOrigin);
  // Used by Adyen's risk checks, and required for Visa and JCB 3DS2 when
  // shopperEmail is missing. Taken from the connection, never the body.
  const ip = shopperIp(http, remoteAddress);
  const request = buildPaymentRequest({
    body,
    secrets,
    order,
    origin,
    paymentMethod,
    metadataFlow,
    ip,
    adyenOrder,
    amount,
  });
  const result = await recordedCall({
    correlationId: order.id,
    name: "Checkout API /payments",
    endpoint: "https://checkout-test.adyen.com/v72/payments",
    request,
    execute: () => client.payments(request, idempotencyKey),
  });
  return status(201, {
    correlationId: order.id,
    attemptId: attempt.id,
    result,
    resolution: settleAttempt(order, attempt, result),
  });
}

// Spec: knowledge/components/adyen-digital.md
// Pay by Link: create a link and read it back.
import { PAYMENT_METHOD_RULES } from "@suite/platform/payment-methods.ts";
import { requestOrigin } from "@suite/platform/security.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import { object, amountFrom, resultField } from "../input.ts";
import { recordedCall, resolveAndStore } from "../orders.ts";
import { requestBase } from "../requests.ts";
import { Elysia } from "elysia";

export const payByLinkRoutes = new Elysia()
  .post("/api/digital/payment-links", async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    const amount = amountFrom(body.amount);
    const { client, secrets, id: profileId } = await profileClient(http);
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
    const origin = requestOrigin(http, context.config.publicOrigin);
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
    return status(201, { correlationId: order.id, order: updated, paymentLink: result });
  })
  .get("/api/digital/payment-links/:orderId", async ({ params, request: http }) => {
    const order = context.repository.getOrder(params.orderId);
    if (!order?.paymentLinkId) return status(404, { error: "Payment link not found." });
    const { client } = await profileClient(http);
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
    return { paymentLink: result, resolution };
  });

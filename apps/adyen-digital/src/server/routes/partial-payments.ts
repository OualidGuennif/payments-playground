// Spec: knowledge/components/adyen-digital.md
// Advanced partial payments: gift card balance, /orders and /orders/cancel.
import { PAYMENT_METHOD_RULES } from "@suite/platform/payment-methods.ts";
import { rejectRawCardData } from "@suite/platform/sanitize.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import { object, sanitizePaymentMethod, orderReference, amountFrom } from "../input.ts";
import { recordedCall } from "../orders.ts";
import { Elysia } from "elysia";

export const partialPaymentRoutes = new Elysia()
  .post("/api/digital/partial-orders", async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    const amount = amountFrom(body.amount);
    const { client, secrets, id: profileId } = await profileClient(http);
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
    return status(201, { correlationId: order.id, order, adyenOrder: result });
  })
  // Advanced flow only: Adyen Web's onBalanceCheck. With a session Adyen Web
  // asks Adyen itself. The gift card number arrives encrypted.
  .post("/api/digital/gift-card-balance", async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    rejectRawCardData(body.paymentMethod);
    const { client, secrets } = await profileClient(http);
    const correlationId = String(body.correlationId ?? crypto.randomUUID());
    const request = {
      merchantAccount: secrets.merchantAccount,
      amount: amountFrom(body.amount),
      paymentMethod: sanitizePaymentMethod(object(body.paymentMethod)),
    };
    const result = await recordedCall({
      correlationId,
      name: "Checkout API /paymentMethods/balance",
      endpoint: "https://checkout-test.adyen.com/v72/paymentMethods/balance",
      request,
      execute: () => client.paymentMethodsBalance(request),
    });
    return { correlationId, result };
  })
  // Adyen Web's onOrderCancel (Drop-in offers it once part of an order is
  // paid). Adyen then cancels or refunds what was paid into the order, and
  // ORDER_CLOSED success=false settles it here.
  .post(
    "/api/digital/partial-orders/:id/cancel",
    async ({ params, body: rawBody, request: http }) => {
      const order = context.repository.getOrder(params.id);
      if (!order) return status(404, { error: "Order not found." });
      const adyenOrder = orderReference(object(rawBody).order);
      if (!adyenOrder) return status(400, { error: "orderData and pspReference are required." });
      const { client, secrets } = await profileClient(http);
      const request = { merchantAccount: secrets.merchantAccount, order: adyenOrder };
      const result = await recordedCall({
        correlationId: order.id,
        name: "Checkout API /orders/cancel",
        endpoint: "https://checkout-test.adyen.com/v72/orders/cancel",
        request,
        execute: () => client.cancelOrder(request, crypto.randomUUID()),
      });
      return { correlationId: order.id, result };
    },
  );

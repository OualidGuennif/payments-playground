// Spec: knowledge/components/adyen-digital.md
// Merchant-initiated transactions on a card stored earlier.
import { rejectRawCardData } from "@suite/platform/sanitize.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import { object, amountFrom } from "../input.ts";
import { recordedCall, settleAttempt } from "../orders.ts";
import { Elysia } from "elysia";

export const mitRoutes = new Elysia().post(
  "/api/digital/mit",
  async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    rejectRawCardData(body);
    const token = String(body.storedPaymentMethodId ?? "");
    const shopperReference = String(body.shopperReference ?? "");
    if (!token || shopperReference.length < 3) {
      return status(400, {
        error: "storedPaymentMethodId and a non-PII shopperReference are required.",
      });
    }
    const amount = amountFrom(body.amount);
    const { client, secrets, id: profileId } = await profileClient(http);
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
      recurringProcessingModel:
        body.recurringProcessingModel === "Subscription" ? "Subscription" : "UnscheduledCardOnFile",
    };
    const result = await recordedCall({
      correlationId: order.id,
      name: "MIT Checkout API /payments",
      endpoint: "https://checkout-test.adyen.com/v72/payments",
      request,
      execute: () => client.payments(request, crypto.randomUUID()),
    });
    const resolution = settleAttempt(order, attempt, result);
    return status(201, { correlationId: order.id, result, resolution });
  },
);

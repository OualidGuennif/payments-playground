// Spec: knowledge/components/adyen-digital.md
// Back Office: the order list, one order, and its capture, cancel and refund actions.
import { SUPPORTED_COUNTRY_CODES } from "@suite/platform/addresses.ts";
import { lifecycleSourceAttempt, PAYMENT_METHOD_CAPABILITIES } from "@suite/platform/lifecycle.ts";
import { PAYMENT_METHOD_RULES } from "@suite/platform/payment-methods.ts";
import type { Amount } from "@suite/platform/types.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import { object, resultField } from "../input.ts";
import { recordedCall, lifecycleFor } from "../orders.ts";
import { Elysia } from "elysia";

export const backOfficeRoutes = new Elysia()
  .get("/api/digital/config", () => {
    return {
      countries: SUPPORTED_COUNTRY_CODES,
      paymentMethodRules: PAYMENT_METHOD_RULES,
      capabilities: PAYMENT_METHOD_CAPABILITIES,
    };
  })
  .get("/api/digital/orders", () => {
    const orders = context.repository.listOrders("digital").map((order) => {
      const attempts = context.repository.listAttempts(order.id);
      return { ...order, attempts, ...lifecycleFor(order, attempts) };
    });
    return { orders };
  })
  .get("/api/digital/orders/:id", ({ params }) => {
    const order = context.repository.getOrder(params.id);
    if (!order) return status(404, { error: "Order not found." });
    const attempts = context.repository.listAttempts(order.id);
    return {
      order,
      attempts,
      timeline: context.repository.timeline(order.id),
      ...lifecycleFor(order, attempts),
    };
  })
  .post(
    "/api/digital/orders/:id/actions/:action",
    async ({ params, body: rawBody, request: http }) => {
      const order = context.repository.getOrder(params.id);
      if (!order) return status(404, { error: "Order not found." });
      const action = params.action;
      if (action !== "capture" && action !== "cancel" && action !== "refund") {
        return status(400, { error: "Unsupported lifecycle action." });
      }
      const idempotencyKey = String(
        http.headers.get("idempotency-key") ?? crypto.randomUUID(),
      ).slice(0, 64);
      const known = context.repository.findAction(idempotencyKey);
      if (known) {
        if (known.state === "requested") {
          // Adyen's own answer to a duplicate still in flight (error code 704).
          return status(409, { error: "This request is already being processed." });
        }
        return { duplicate: true, request: known };
      }

      const attempts = context.repository.listAttempts(order.id);
      const sourceAttempt = lifecycleSourceAttempt(attempts);
      if (!sourceAttempt?.pspReference) {
        return status(409, { error: "No authorised payment is available." });
      }
      const { permissions } = lifecycleFor(order, attempts);
      const permission = permissions[action];
      if (!permission.allowed) return status(409, { error: permission.reason, permissions });

      const body = object(rawBody);
      let amount: Amount | undefined;
      if (action !== "cancel") {
        const max = permission.maxValue ?? 0;
        const value = body.amount === undefined ? max : Number(object(body.amount).value);
        if (!Number.isInteger(value) || value < 1 || value > max) {
          return status(400, { error: `The amount must be between 1 and ${max} minor units.` });
        }
        if (!permission.partial && value !== max) {
          return status(400, { error: `This payment method only takes the full ${action}.` });
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
        return status(409, { error: "This request is already being processed." });
      }
      const { client, secrets } = await profileClient(http);
      const request = {
        merchantAccount: secrets.merchantAccount,
        reference: `${action}-${order.reference}`.slice(0, 80),
        ...(amount ? { amount } : {}),
      };
      try {
        const result = await recordedCall({
          correlationId: order.id,
          name: `Checkout API lifecycle ${action}`,
          endpoint: `https://checkout-test.adyen.com/v72/payments/${sourceAttempt.pspReference}/${action}s`,
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
        return status(202, { actionId: record.id, idempotencyKey, result });
      } catch (error) {
        context.repository.updateAction(record.id, {
          state: "rejected",
          reason: error instanceof Error ? error.message : "Adyen rejected the request.",
        });
        throw error;
      }
    },
  );

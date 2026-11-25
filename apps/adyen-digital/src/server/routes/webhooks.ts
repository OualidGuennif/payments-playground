// Spec: knowledge/components/adyen-digital.md
// Adyen's standard webhooks in, and what arrived for an order out.
import { verifyStandardHmac } from "@suite/platform/hmac.ts";
import { sanitize } from "@suite/platform/sanitize.ts";
import type { JsonValue } from "@suite/platform/types.ts";
import { status } from "elysia";
import { context } from "../context.ts";
import { object } from "../input.ts";
import { resolveAndStore } from "../orders.ts";
import {
  hmacSecrets,
  webhookItems,
  correlateWebhook,
  MODIFICATION_EVENTS,
} from "../webhook-items.ts";
import { Elysia } from "elysia";

export const webhookRoutes = new Elysia()
  .post(
    "/webhook",
    async ({ body: rawBody }) => {
      const payload = rawBody;
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
        const dedupeKey = [item.pspReference, item.originalReference, eventType, item.success].join(
          ":",
        );
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
          let attempt = context.repository
            .listAttempts(order.id)
            .find((value) => value.pspReference === item.pspReference);
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

      if (invalid) return status(401, { error: "Invalid or missing HMAC signature." });
      return status(202, "[accepted]");
    },
    { parse: "json" },
  )
  .get("/api/digital/webhooks/:correlationId", ({ params }) => {
    const entries = context.repository
      .timeline(params.correlationId)
      .filter((entry) => entry.kind === "webhook");
    return {
      waiting: entries.length === 0,
      entries: entries as unknown as JsonValue,
    };
  });

// Spec: knowledge/components/adyen-digital.md
// Sessions flow: the server creates the session; Adyen Web does the rest.
import { requestOrigin } from "@suite/platform/security.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import { object, amountFrom, resultField } from "../input.ts";
import { recordedCall } from "../orders.ts";
import { SESSION_VALIDITY_MS, buildSessionRequest } from "../requests.ts";
import { Elysia } from "elysia";

export const sessionsRoutes = new Elysia().post(
  "/api/digital/sessions",
  async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    const amount = amountFrom(body.amount);
    const { client, secrets, id: profileId } = await profileClient(http);
    const expiresAt = new Date(Date.now() + SESSION_VALIDITY_MS).toISOString();
    const order = context.repository.createOrder({
      appId: "digital",
      flow: String(body.flow ?? "sessions-dropin"),
      amount,
      expiresAt,
      metadata: { profileId },
    });
    const idempotencyKey = crypto.randomUUID();
    const origin = requestOrigin(http, context.config.publicOrigin);
    const request = buildSessionRequest({ body, secrets, order, origin, expiresAt });
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
    return status(201, {
      correlationId: order.id,
      order,
      session: result,
    });
  },
);

// Spec: knowledge/components/adyen-digital.md
// Sessions flow: the server creates the session, and decides alone when an order gets a new one
// (ADR-022); Adyen Web does the rest.
import { requestOrigin } from "@suite/platform/security.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import { object, amountFrom, resultField } from "../input.ts";
import { recordedCall, resolveAndStore } from "../orders.ts";
import { SESSION_VALIDITY_MS, buildSessionRequest } from "../requests.ts";
import { SESSION_REFUSAL_LIMIT, renewalDecision } from "../session-renewal.ts";
import { Elysia } from "elysia";

export const sessionsRoutes = new Elysia()
  .post("/api/digital/sessions", async ({ body: rawBody, request: http }) => {
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
  })
  .post("/api/digital/orders/:id/sessions", async ({ params, body: rawBody, request: http }) => {
    const order = context.repository.getOrder(params.id);
    if (!order) return status(404, { error: "Order not found." });
    const body = object(rawBody);
    const { client, secrets, id: profileId } = await profileClient(http);
    const session = context.repository.latestSession(order.id);
    // The browser says nothing here that counts: the refusals are the ones Adyen's own webhooks
    // reported for this session, and the order's state is derived again from Adyen's answers.
    const refusals = session?.adyenSessionId
      ? context.repository.sessionRefusals(session.adyenSessionId)
      : 0;
    const decision = renewalDecision({
      flow: order.flow,
      orderState: resolveAndStore(order).state,
      sameProfile: context.repository.orderMetadata(order.id).profileId === profileId,
      session,
      refusals,
    });
    if (decision.kind === "refuse") return status(409, { error: decision.error });
    const waiting = { waiting: true, refusals: decision.refusals, limit: SESSION_REFUSAL_LIMIT };
    if (decision.kind === "wait" || !session) return status(202, waiting);
    // Two requests can both find the renewal due; only the one that claims the session renews it.
    if (!context.repository.claimSession(session.id, "created", "renewing")) {
      return status(202, waiting);
    }
    const idempotencyKey = crypto.randomUUID();
    const origin = requestOrigin(http, context.config.publicOrigin);
    // The new session never outlives its order; the amount and reference are the order's too.
    const expiresAt = order.expiresAt ?? new Date(Date.now() + SESSION_VALIDITY_MS).toISOString();
    const request = buildSessionRequest({ body, secrets, order, origin, expiresAt });
    let result: unknown;
    try {
      result = await recordedCall({
        correlationId: order.id,
        name: "Checkout API /sessions",
        endpoint: "https://checkout-test.adyen.com/v72/sessions",
        request,
        execute: () => client.sessions(request, idempotencyKey),
      });
    } catch (error) {
      // Adyen made no session, so the current one stays the one in use.
      context.repository.claimSession(session.id, "renewing", "created");
      throw error;
    }
    context.repository.createSession({
      orderId: order.id,
      kind: session.kind,
      adyenSessionId: String(resultField(result, "id") ?? ""),
      state: "created",
      expiresAt: String(resultField(result, "expiresAt") ?? expiresAt),
    });
    context.repository.claimSession(session.id, "renewing", "replaced");
    context.repository.audit({
      appId: "digital",
      correlationId: order.id,
      action: "session.renew",
      outcome: "success",
      payload: {
        profileId,
        idempotencyKey,
        refusals: decision.refusals,
        replacedSessionId: session.adyenSessionId ?? "",
      },
    });
    return status(201, {
      correlationId: order.id,
      order: context.repository.getOrder(order.id) ?? order,
      session: result,
    });
  });

// Spec: knowledge/components/adyen-digital.md
// Advanced flow: /paymentMethods, /payments, /payments/details and the redirect return.
import { resolveShopperEmail, splitsCardFundingSources } from "@suite/platform/sessionContext.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import { status } from "elysia";
import { context, profileClient } from "../context.ts";
import {
  object,
  orderReference,
  amountFrom,
  conversionIdFrom,
  countryFrom,
  resultField,
} from "../input.ts";
import { recordedCall, resolveAndStore, settleAttempt, RESULT_CODE_FOR_STATE } from "../orders.ts";
import { createPayment } from "../payments.ts";
import { attemptForRedirect, earlierRedirectAnswer, reloadedResult } from "../redirect-return.ts";
import { Elysia } from "elysia";

export const advancedRoutes = new Elysia()
  .post("/api/digital/payment-methods", async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    const amount = amountFrom(body.amount);
    const countryCode = countryFrom(body.countryCode);
    const { client, secrets } = await profileClient(http);
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
      // After a partial payment Adyen Web asks again with the order, for the
      // methods that can pay what is left of it.
      ...(orderReference(body.order) ? { order: orderReference(body.order) } : {}),
    };
    const result = await recordedCall({
      correlationId,
      name: "Checkout API /paymentMethods",
      endpoint: "https://checkout-test.adyen.com/v72/paymentMethods",
      request,
      execute: () => client.paymentMethods(request),
    });
    return { correlationId, shopperConversionId, paymentMethodsResponse: result };
  })
  .post("/api/digital/payments", ({ body, request: http, server }) =>
    createPayment(object(body), http, server?.requestIP(http)?.address),
  )
  .post("/api/digital/payments/details", async ({ body: rawBody, request: http }) => {
    const body = object(rawBody);
    const correlationId = String(body.correlationId ?? "");
    const order = context.repository.getOrder(correlationId);
    if (!order) return status(404, { error: "Unknown correlationId." });
    const { client } = await profileClient(http);
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
    const attempt = context.repository
      .listAttempts(order.id)
      .findLast((item) => item.state === "pending" || item.state === "created");
    const resolution = attempt ? settleAttempt(order, attempt, result) : undefined;
    return { correlationId, result, resolution };
  })
  // A redirect method (iDEAL, Klarna, a 3DS1 bank page...) sends the shopper
  // back to /result with a redirectResult and nothing else had told this server
  // how the payment ended. Submitting it to /payments/details settles the order,
  // for Sessions too: the redirectResult carries the whole payment, so the
  // call does not need the session. A reload must not submit it twice, so the
  // same redirectResult answers with what is already stored; any other one is
  // submitted, even when older attempts of the order are settled.
  .post(
    "/api/digital/orders/:id/redirect-result",
    async ({ params, body: rawBody, request: http }) => {
      const order = context.repository.getOrder(params.id);
      if (!order) return status(404, { error: "Order not found." });
      const body = object(rawBody);
      const redirectResult = typeof body.redirectResult === "string" ? body.redirectResult : "";
      if (!redirectResult) return status(400, { error: "redirectResult is required." });
      const foreign = (answer: unknown) => {
        const merchantReference = resultField(answer, "merchantReference");
        return typeof merchantReference === "string" && merchantReference !== order.reference;
      };
      const earlier = earlierRedirectAnswer(context.repository.timeline(order.id), redirectResult);
      if (earlier && foreign(earlier)) {
        return status(409, { error: "This redirect belongs to another order." });
      }
      if (earlier) {
        return {
          correlationId: order.id,
          alreadySettled: true,
          result: reloadedResult(
            earlier,
            context.repository.listAttempts(order.id),
            RESULT_CODE_FOR_STATE,
          ),
          resolution: resolveAndStore(order),
        };
      }
      const { client } = await profileClient(http);
      const request = { details: { redirectResult } };
      const result = await recordedCall({
        correlationId: order.id,
        name: "Checkout API /payments/details",
        endpoint: "https://checkout-test.adyen.com/v72/payments/details",
        request,
        execute: () => client.paymentDetails(request, crypto.randomUUID()),
      });
      if (foreign(result)) {
        return status(409, { error: "This redirect belongs to another order." });
      }
      // Sessions orders get their attempt from the session result, which a
      // redirect skips; unless its webhook came first, this is the first time
      // the server sees the payment.
      const attempt =
        attemptForRedirect(
          context.repository.listAttempts(order.id),
          resultField(result, "pspReference"),
        ) ??
        context.repository.createAttempt({
          orderId: order.id,
          amount: order.amount,
          state: "created",
          paymentMethod: String(object(resultField(result, "paymentMethod")).type ?? "unknown"),
        });
      return {
        correlationId: order.id,
        result,
        resolution: settleAttempt(order, attempt, result),
      };
    },
  );

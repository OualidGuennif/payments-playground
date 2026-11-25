// Spec: knowledge/components/adyen-digital.md
// Advanced and API only: the merchant's server makes every Checkout call Adyen Web asks for.
import { unwrap } from "@suite/ui/client.ts";
import type { RefObject } from "react";
import { field as valueAt } from "../lib/read.ts";
import { api, type CallbackActions, field, type PaymentOutcome } from "./client.ts";
import { orderProgress, partialAmount } from "./partial.ts";

/** What the handlers of one Advanced or API-only checkout read and write while it runs. */
export interface AdvancedRun {
  flow: "advanced" | "api-only";
  integration: "dropin" | "component";
  profileId: string;
  amount: number;
  currency: string;
  country: string;
  locale: string;
  nativeThreeDS: boolean;
  refs: {
    correlation: RefObject<string | null>;
    shopperConversion: RefObject<string | null>;
    partialOrderId: RefObject<string | null>;
    remaining: RefObject<number | null>;
    giftCardBalance: RefObject<number | null>;
    customCardHolderName: RefObject<HTMLInputElement | null>;
    lastPayment: RefObject<PaymentOutcome>;
  };
  addCallback(name: string, payload: unknown): void;
  updateCorrelation(id: string): void;
  resetPartialOrder(): void;
  setError(message: string): void;
}

export async function loadPaymentMethods(run: AdvancedRun) {
  return unwrap(
    await api(run.profileId).api.digital["payment-methods"].post({
      amount: { value: run.amount, currency: run.currency },
      countryCode: run.country,
      shopperLocale: run.locale,
    }),
  ) as {
    correlationId: string;
    shopperConversionId: string;
    paymentMethodsResponse: unknown;
  };
}

/** onSubmit and onAdditionalDetails: /payments and /payments/details through this server. */
export function paymentHandlers(run: AdvancedRun): Record<string, unknown> {
  const { flow, profileId, refs } = run;
  return {
    onSubmit: async (state: unknown, _component: unknown, actions: CallbackActions) => {
      run.addCallback("onSubmit", state);
      try {
        const stateData = (state as { data?: Record<string, unknown> }).data ?? {};
        const holderName = refs.customCardHolderName.current?.value;
        if (flow === "api-only" && holderName) {
          stateData.paymentMethod = {
            ...((stateData.paymentMethod as Record<string, unknown>) ?? {}),
            holderName,
          };
        }
        const response = unwrap(
          await (flow === "api-only"
            ? api(profileId).api.digital["api-only"]
            : api(profileId).api.digital.payments
          ).post({
            flow: flow === "api-only" ? "api-only-pci" : `advanced-${run.integration}`,
            countryCode: run.country,
            shopperLocale: run.locale,
            shopperConversionId: refs.shopperConversion.current,
            nativeThreeDS: run.nativeThreeDS,
            ...stateData,
            // Once a gift card opened an order, every payment goes into it and
            // charges only its share; otherwise the whole amount.
            ...(refs.partialOrderId.current ? { orderId: refs.partialOrderId.current } : {}),
            amount: {
              value: partialAmount({
                total: run.amount,
                remaining: refs.remaining.current,
                giftCardBalance:
                  field(stateData.paymentMethod, "type") === "giftcard"
                    ? refs.giftCardBalance.current
                    : null,
              }),
              currency: run.currency,
            },
          }),
        ) as {
          correlationId: string;
          result: unknown;
        };
        run.updateCorrelation(response.correlationId);
        // onPaymentMethodsRequest runs before onOrderUpdated reports this.
        const progress = orderProgress(valueAt(response.result, "order"));
        if (progress) refs.remaining.current = progress.remaining;
        refs.lastPayment.current = {
          pspReference: field(response.result, "pspReference"),
          resultCode: field(response.result, "resultCode"),
          method: field(stateData.paymentMethod, "brand") ?? field(stateData.paymentMethod, "type"),
        };
        actions.resolve(response.result);
      } catch (cause) {
        run.setError(cause instanceof Error ? cause.message : "Payment request failed.");
        actions.reject();
      }
    },
    onAdditionalDetails: async (state: unknown, _component: unknown, actions: CallbackActions) => {
      run.addCallback("onAdditionalDetails", state);
      try {
        const stateData = (state as { data?: Record<string, unknown> }).data ?? {};
        const response = unwrap(
          await api(profileId).api.digital.payments.details.post({
            correlationId: refs.correlation.current,
            ...stateData,
          }),
        ) as { result: unknown };
        refs.lastPayment.current = {
          ...refs.lastPayment.current,
          pspReference:
            field(response.result, "pspReference") ?? refs.lastPayment.current.pspReference,
          resultCode: field(response.result, "resultCode"),
        };
        actions.resolve(response.result);
      } catch (cause) {
        run.setError(cause instanceof Error ? cause.message : "Additional details failed.");
        actions.reject();
      }
    },
  };
}

// Advanced flow: what Adyen Web does on its own with a session, the
// merchant's server does here. Without onBalanceCheck a gift card is
// submitted for the whole amount and refused ("Not enough balance").
export function partialPaymentHandlers(run: AdvancedRun): Record<string, unknown> {
  const { profileId, refs, amount, currency } = run;
  const failure = (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause : new Error(fallback);
  return {
    onBalanceCheck: async (
      resolve: (response: unknown) => void,
      reject: (error: Error) => void,
      data: unknown,
    ) => {
      run.addCallback("onBalanceCheck", data);
      try {
        const response = unwrap(
          await api(profileId).api.digital["gift-card-balance"].post({
            correlationId: refs.partialOrderId.current ?? refs.correlation.current,
            amount: { value: refs.remaining.current ?? amount, currency },
            paymentMethod: valueAt(data, "paymentMethod"),
          }),
        ) as { result: unknown };
        const balance = valueAt(response.result, "balance.value");
        refs.giftCardBalance.current = typeof balance === "number" ? balance : null;
        resolve(response.result);
      } catch (cause) {
        reject(failure(cause, "The balance check failed."));
      }
    },
    onOrderRequest: async (
      resolve: (order: unknown) => void,
      reject: (error: Error) => void,
      data: unknown,
    ) => {
      run.addCallback("onOrderRequest", data);
      try {
        const response = unwrap(
          await api(profileId).api.digital["partial-orders"].post({
            amount: { value: amount, currency },
          }),
        ) as { correlationId: string; adyenOrder: unknown };
        refs.partialOrderId.current = response.correlationId;
        run.updateCorrelation(response.correlationId);
        refs.remaining.current = orderProgress(response.adyenOrder)?.remaining ?? null;
        resolve(response.adyenOrder);
      } catch (cause) {
        reject(failure(cause, "The order could not be created."));
      }
    },
    // Drop-in offers to remove a paid gift card, which cancels the order.
    onOrderCancel: async (
      data: unknown,
      actions: { resolve(value: unknown): void; reject(error: string): void },
    ) => {
      run.addCallback("onOrderCancel", data);
      try {
        if (refs.partialOrderId.current) {
          unwrap(
            await api(profileId)
              .api.digital["partial-orders"]({ id: refs.partialOrderId.current })
              .cancel.post({ order: valueAt(data, "order") }),
          );
        }
        run.resetPartialOrder();
        actions.resolve({ amount: { value: amount, currency } });
      } catch (cause) {
        actions.reject(failure(cause, "The order could not be cancelled.").message);
      }
    },
    // After a partial payment: the methods that can pay what is left.
    onPaymentMethodsRequest: async (
      data: unknown,
      actions: { resolve(response: unknown): void; reject(): void },
    ) => {
      run.addCallback("onPaymentMethodsRequest", data);
      try {
        const response = unwrap(
          await api(profileId).api.digital["payment-methods"].post({
            correlationId: refs.partialOrderId.current ?? refs.correlation.current,
            amount: { value: refs.remaining.current ?? amount, currency },
            countryCode: run.country,
            shopperLocale: run.locale,
            shopperConversionId: refs.shopperConversion.current,
            order: valueAt(data, "order"),
          }),
        ) as { paymentMethodsResponse: unknown };
        actions.resolve(response.paymentMethodsResponse);
      } catch {
        actions.reject();
      }
    },
  };
}

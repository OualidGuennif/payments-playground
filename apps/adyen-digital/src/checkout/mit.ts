// Spec: knowledge/components/adyen-digital.md
// Merchant-initiated transactions: charge a card Adyen stored for this week's shopper.
import { unwrap } from "@suite/ui/client.ts";
import { api } from "./client.ts";
import type { RecurringModel, StoredMethod } from "./flow-helpers.ts";

export async function listStoredMethods(input: {
  profileId: string;
  amount: number;
  currency: string;
  country: string;
  locale: string;
}): Promise<StoredMethod[]> {
  const response = unwrap(
    await api(input.profileId).api.digital["payment-methods"].post({
      amount: { value: input.amount, currency: input.currency },
      countryCode: input.country,
      shopperLocale: input.locale,
    }),
  ) as { paymentMethodsResponse: { storedPaymentMethods?: StoredMethod[] } };
  return response.paymentMethodsResponse.storedPaymentMethods ?? [];
}

export async function chargeStoredMethod(input: {
  profileId: string;
  amount: number;
  currency: string;
  storedPaymentMethodId: string;
  shopperReference: string;
  recurringModel: RecurringModel;
}) {
  return unwrap(
    await api(input.profileId).api.digital.mit.post({
      amount: { value: input.amount, currency: input.currency },
      storedPaymentMethodId: input.storedPaymentMethodId,
      shopperReference: input.shopperReference,
      recurringProcessingModel: input.recurringModel,
    }),
  ) as {
    correlationId: string;
    result: Record<string, unknown>;
  };
}

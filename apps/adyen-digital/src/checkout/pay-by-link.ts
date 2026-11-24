// Spec: knowledge/components/adyen-digital.md
// Pay by Link: Adyen hosts the payment page; this server creates the link and reads it back.
import { unwrap } from "@suite/ui/client.ts";
import { api, field } from "./client.ts";

export async function createPaymentLink(input: {
  profileId: string;
  amount: number;
  currency: string;
  country: string;
  locale: string;
  validityHours: number;
  reusable: boolean;
}) {
  return unwrap(
    await api(input.profileId).api.digital["payment-links"].post({
      amount: { value: input.amount, currency: input.currency },
      countryCode: input.country,
      shopperLocale: input.locale,
      validityHours: input.validityHours,
      reusable: input.reusable,
    }),
  ) as {
    correlationId: string;
    paymentLink: Record<string, unknown>;
  };
}

/** The link's status as Adyen reports it, or the order's derived state when it has none. */
export async function readLinkState(profileId: string, orderId: string): Promise<string> {
  const response = unwrap(await api(profileId).api.digital["payment-links"]({ orderId }).get()) as {
    paymentLink: Record<string, unknown>;
    resolution: { state: string };
  };
  return field(response.paymentLink, "status") ?? response.resolution.state;
}

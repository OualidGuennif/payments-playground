// Spec: knowledge/components/adyen-agentic-commerce.md
// Every Adyen call of the app. The client is always built for EnvironmentEnum.TEST, and each request
// lists its fields explicitly: nothing from a browser or an agent is forwarded as is.
import { CheckoutAPI, Client, EnvironmentEnum, hmacValidator, Types } from "@adyen/api-library";
import { config, CURRENCY, SHOPPER_REFERENCE } from "./config";

type C = typeof Types.checkout;
const checkoutTypes: C = Types.checkout;

export class PaymentsUnavailable extends Error {}

function api(): { checkout: CheckoutAPI; merchantAccount: string } {
  const { apiKey, merchantAccount } = config().adyen;
  if (!apiKey || !merchantAccount) throw new PaymentsUnavailable("Adyen TEST credentials are not set");
  const client = new Client({ apiKey, environment: EnvironmentEnum.TEST });
  return { checkout: new CheckoutAPI(client), merchantAccount };
}

export type SessionRequest = {
  amount: number;
  reference: string;
  returnUrl: string;
  shopperEmail?: string;
  purpose: "order" | "card-save";
  metadata: Record<string, string>;
};

export async function createSession(input: SessionRequest) {
  const { checkout, merchantAccount } = api();
  const S = checkoutTypes.CreateCheckoutSessionRequest;
  const cardSave = input.purpose === "card-save";
  const response = await checkout.PaymentsApi.sessions(
    {
      merchantAccount,
      amount: { currency: CURRENCY, value: input.amount },
      reference: input.reference,
      returnUrl: input.returnUrl,
      countryCode: "FR",
      shopperLocale: "en-US",
      channel: S.ChannelEnum.Web,
      shopperReference: SHOPPER_REFERENCE,
      shopperEmail: input.shopperEmail,
      shopperInteraction: S.ShopperInteractionEnum.Ecommerce,
      // A saved card must allow UnscheduledCardOnFile, the model an agent payment uses later.
      recurringProcessingModel: cardSave
        ? S.RecurringProcessingModelEnum.UnscheduledCardOnFile
        : S.RecurringProcessingModelEnum.CardOnFile,
      storePaymentMethodMode: cardSave
        ? S.StorePaymentMethodModeEnum.Enabled
        : S.StorePaymentMethodModeEnum.AskForConsent,
      allowedPaymentMethods: cardSave ? ["scheme"] : undefined,
      metadata: input.metadata,
    },
    { idempotencyKey: `session-${input.reference}` },
  );
  if (!response.id || !response.sessionData) throw new Error("Adyen returned no session");
  return { id: response.id, sessionData: response.sessionData };
}

export async function sessionResult(sessionId: string, result: string) {
  const { checkout } = api();
  const response = await checkout.PaymentsApi.getResultOfPaymentSession(sessionId, result);
  return {
    status: response.status ? String(response.status) : "unknown",
    reference: response.reference,
    payments: (response.payments ?? []).map((p) => ({
      pspReference: p.pspReference,
      resultCode: p.resultCode ? String(p.resultCode) : undefined,
      amount: p.amount?.value,
    })),
  };
}

export type StoredCard = {
  storedPaymentMethodId: string;
  brand: string;
  lastFour: string;
  expiryMonth: string;
  expiryYear: string;
  holderName?: string;
  models: string[];
};

export async function storedCards(): Promise<StoredCard[]> {
  const { checkout, merchantAccount } = api();
  const response = await checkout.RecurringApi.getTokensForStoredPaymentDetails(
    SHOPPER_REFERENCE,
    merchantAccount,
  );
  return (response.storedPaymentMethods ?? [])
    .filter((m) => m.id && m.lastFour && (m.type === "scheme" || m.brand))
    .map((m) => ({
      storedPaymentMethodId: m.id!,
      brand: m.brand ?? m.type ?? "card",
      lastFour: m.lastFour!,
      expiryMonth: m.expiryMonth ?? "",
      expiryYear: m.expiryYear ?? "",
      holderName: m.holderName,
      models: m.supportedRecurringProcessingModels ?? [],
    }));
}

export async function forgetCard(storedPaymentMethodId: string): Promise<void> {
  const { checkout, merchantAccount } = api();
  await checkout.RecurringApi.deleteTokenForStoredPaymentDetails(
    storedPaymentMethodId,
    SHOPPER_REFERENCE,
    merchantAccount,
  );
}

export type AgentPayment = {
  amount: number;
  reference: string;
  storedPaymentMethodId: string;
  idempotencyKey: string;
  shopperEmail?: string;
  metadata: Record<string, string>;
};

export async function payWithSavedCard(input: AgentPayment) {
  const { checkout, merchantAccount } = api();
  const P = checkoutTypes.PaymentRequest;
  const response = await checkout.PaymentsApi.payments(
    {
      merchantAccount,
      amount: { currency: CURRENCY, value: input.amount },
      reference: input.reference,
      // Required by the API type; a ContAuth payment never redirects the shopper.
      returnUrl: `${config().publicOrigin}/account`,
      paymentMethod: {
        type: checkoutTypes.CardDetails.TypeEnum.Scheme,
        storedPaymentMethodId: input.storedPaymentMethodId,
      },
      shopperReference: SHOPPER_REFERENCE,
      shopperInteraction: P.ShopperInteractionEnum.ContAuth,
      recurringProcessingModel: P.RecurringProcessingModelEnum.UnscheduledCardOnFile,
      shopperEmail: input.shopperEmail,
      metadata: input.metadata,
    },
    { idempotencyKey: input.idempotencyKey },
  );
  return {
    resultCode: response.resultCode ? String(response.resultCode) : "Error",
    pspReference: response.pspReference,
    refusalReason: response.refusalReason,
    refusalReasonCode: response.refusalReasonCode,
  };
}

export type NotificationItem = {
  pspReference?: string;
  originalReference?: string;
  merchantReference?: string;
  merchantAccountCode?: string;
  eventCode?: string;
  success?: string;
  amount?: { value?: number; currency?: string };
  eventDate?: string;
  reason?: string;
  additionalData?: Record<string, string>;
};

export function validHmac(item: NotificationItem): boolean {
  const key = config().adyen.hmacKey;
  if (!key || !item.additionalData?.hmacSignature) return false;
  try {
    type Item = Parameters<InstanceType<typeof hmacValidator>["validateHMAC"]>[0];
    return new hmacValidator().validateHMAC(item as Item, key);
  } catch {
    return false;
  }
}

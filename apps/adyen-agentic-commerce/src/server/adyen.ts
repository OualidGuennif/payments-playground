// Spec: knowledge/components/adyen-agentic-commerce.md
// Every Adyen call of the app. The client is always built for EnvironmentEnum.TEST, and each request
// lists its fields explicitly: nothing from a browser or an agent is forwarded as is.
import { CheckoutAPI, Client, EnvironmentEnum, hmacValidator, Types } from "@adyen/api-library";
import { config, CURRENCY } from "./config";

type C = typeof Types.checkout;
const checkoutTypes: C = Types.checkout;

export class PaymentsUnavailable extends Error {}

function api(): { checkout: CheckoutAPI; merchantAccount: string } {
  const { apiKey, merchantAccount } = config().adyen;
  if (!apiKey || !merchantAccount)
    throw new PaymentsUnavailable("Adyen TEST credentials are not set");
  const client = new Client({ apiKey, environment: EnvironmentEnum.TEST });
  return { checkout: new CheckoutAPI(client), merchantAccount };
}

export type SessionRequest = {
  amount: number;
  reference: string;
  returnUrl: string;
  shopperEmail?: string;
  // The signed-in account's reference; a guest has none, so nothing can be stored for them.
  shopperReference?: string;
  purpose: "order" | "card-save";
  metadata: Record<string, string>;
};

export async function createSession(input: SessionRequest) {
  const { checkout, merchantAccount } = api();
  const S = checkoutTypes.CreateCheckoutSessionRequest;
  const cardSave = input.purpose === "card-save";
  if (cardSave && !input.shopperReference) throw new Error("A card is saved only to an account");
  const account = input.shopperReference !== undefined;
  const response = await checkout.PaymentsApi.sessions(
    {
      merchantAccount,
      amount: { currency: CURRENCY, value: input.amount },
      reference: input.reference,
      returnUrl: input.returnUrl,
      countryCode: "FR",
      shopperLocale: "en-US",
      channel: S.ChannelEnum.Web,
      shopperReference: input.shopperReference,
      shopperEmail: input.shopperEmail,
      shopperInteraction: S.ShopperInteractionEnum.Ecommerce,
      // A saved card must allow UnscheduledCardOnFile, the model an agent payment uses later.
      recurringProcessingModel: !account
        ? undefined
        : cardSave
          ? S.RecurringProcessingModelEnum.UnscheduledCardOnFile
          : S.RecurringProcessingModelEnum.CardOnFile,
      storePaymentMethodMode: !account
        ? undefined
        : cardSave
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

export async function storedCards(shopperReference: string): Promise<StoredCard[]> {
  const { checkout, merchantAccount } = api();
  const response = await checkout.RecurringApi.getTokensForStoredPaymentDetails(
    shopperReference,
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

export async function forgetCard(
  storedPaymentMethodId: string,
  shopperReference: string,
): Promise<void> {
  const { checkout, merchantAccount } = api();
  await checkout.RecurringApi.deleteTokenForStoredPaymentDetails(
    storedPaymentMethodId,
    shopperReference,
    merchantAccount,
  );
}

export type AgentPayment = {
  amount: number;
  reference: string;
  storedPaymentMethodId: string;
  shopperReference: string;
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
      shopperReference: input.shopperReference,
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

export type NetworkTokenPayment = {
  amount: number;
  reference: string;
  // The agent's one-time credential: used for this call only, never stored or traced.
  token: {
    number: string;
    expiryMonth: string;
    expiryYear: string;
    holderName?: string;
    // Read by Adyen from the number (cardBrand), never taken from the agent.
    brand: string;
  };
  idempotencyKey: string;
  shopperEmail?: string;
  metadata: Record<string, string>;
};

// POST /cardDetails: the brand Adyen reads from the number, so an agent sends only the number and
// its expiry. The first brand Adyen supports for this merchant account wins; none is undefined.
export async function cardBrand(number: string): Promise<string | undefined> {
  const { checkout, merchantAccount } = api();
  const response = await checkout.PaymentsApi.cardDetails({ merchantAccount, cardNumber: number });
  return response.brands?.find((b) => b.type && b.supported !== false)?.type;
}

// Owner decision 2026-11-17 (ADR-015): the agent brings a network token's number and expiry, no
// cryptogram and no CVC, and the store pays it merchant-initiated, as an unscheduled card on file.
// Nothing is stored for later: no storePaymentMethod, and no stored-payment id is sent.
export function networkTokenRequest(
  input: NetworkTokenPayment,
  merchantAccount: string,
): Types.checkout.PaymentRequest {
  const P = checkoutTypes.PaymentRequest;
  return {
    merchantAccount,
    amount: { currency: CURRENCY, value: input.amount },
    reference: input.reference,
    // Required by the API type; a ContAuth payment never redirects the shopper.
    returnUrl: `${config().publicOrigin}/agents`,
    paymentMethod: {
      type: checkoutTypes.CardDetails.TypeEnum.NetworkToken,
      brand: input.token.brand,
      number: input.token.number,
      expiryMonth: input.token.expiryMonth,
      expiryYear: input.token.expiryYear,
      holderName: input.token.holderName,
    },
    shopperInteraction: P.ShopperInteractionEnum.ContAuth,
    recurringProcessingModel: P.RecurringProcessingModelEnum.UnscheduledCardOnFile,
    shopperEmail: input.shopperEmail,
    metadata: input.metadata,
  };
}

export async function payWithNetworkToken(input: NetworkTokenPayment) {
  const { checkout, merchantAccount } = api();
  const response = await checkout.PaymentsApi.payments(
    networkTokenRequest(input, merchantAccount),
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

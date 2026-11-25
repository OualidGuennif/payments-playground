// Spec: knowledge/components/adyen-digital.md
// Checkout API request bodies, built per endpoint: state.data is never forwarded wholesale.
import { buildCheckoutAddresses } from "@suite/platform/addresses.ts";
import {
  buildLineItems,
  paymentsRiskFields,
  resolveShopperEmail,
  sessionRiskFields,
} from "@suite/platform/sessionContext.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import type { Amount, OrderAggregate, ProfileSecrets } from "@suite/platform/types.ts";
import { conversionIdFrom, countryFrom } from "./input.ts";

// What Adyen Web puts in state.data beside paymentMethod and /payments accepts
// (checked against PaymentRequest in api-library 32). Dropping them lost the
// shopper's installment choice, Brazil's CPF and the device fingerprint.
// Addresses and shopperEmail are handled by requestBase.
export const FORWARDED_STATE_DATA = [
  "riskData",
  "installments",
  "socialSecurityNumber",
  "shopperName",
  "telephoneNumber",
  "dateOfBirth",
] as const;

export function forwardedStateData(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    FORWARDED_STATE_DATA.filter((field) => body[field] !== undefined).map((field) => [
      field,
      body[field],
    ]),
  );
}

export function playgroundMetadata(
  flow: "sessions" | "advanced" | "api-only",
): Record<string, string> {
  return {
    playground: "adyen-digital",
    flow,
  };
}

export function requestBase(input: {
  body: Record<string, unknown>;
  secrets: ProfileSecrets;
  order: OrderAggregate;
  origin: string;
  // "payments" gets merchantRiskIndicator too; /sessions and /paymentLinks
  // reject it outright ("contains the following unknown fields").
  context: "sessions" | "payments" | "paymentLinks";
}): Record<string, unknown> {
  const countryCode = countryFrom(input.body.countryCode);
  const addresses = buildCheckoutAddresses({
    countryCode,
    billingAddress: input.body.billingAddress,
    deliveryAddress: input.body.deliveryAddress,
  });
  const billingAddress = addresses.billingAddress;
  // The playground's "Native 3DS" switch; only an explicit false turns it off.
  const nativeThreeDS = input.body.nativeThreeDS !== false;
  // Send postal fields only in deliveryAddress; recipient names stay in shopperName.
  const {
    firstName: _firstName,
    lastName: _lastName,
    ...deliveryAddress
  } = addresses.deliveryAddress;
  return {
    amount: input.order.amount,
    reference: input.order.reference,
    merchantAccount: input.secrets.merchantAccount,
    // Required by /sessions and /payments, /payments rejects the request
    // outright ("Required field 'channel' is not provided") without it. Left
    // off /paymentLinks, whose request schema has no channel field and
    // rejects unknown ones.
    ...(input.context === "paymentLinks" ? {} : { channel: "Web" }),
    countryCode,
    shopperLocale: String(input.body.shopperLocale ?? "en-US"),
    shopperReference: weeklyShopperReference(),
    shopperEmail: resolveShopperEmail(input.body.shopperEmail),
    // Required for line-item-aware methods (Klarna and other BNPL) to be
    // considered eligible at all, without it they're silently excluded.
    lineItems: buildLineItems(input.order.amount),
    returnUrl: `${input.origin}/result?orderId=${input.order.id}`,
    billingAddress,
    deliveryAddress,
    // Lets the shopper opt in to saving the card (shown as a checkbox in the
    // Card component) so the "save card" / one-click flow can be previewed ,
    // Sessions-only: the Advanced flow's equivalent is the client-side
    // enableStoreDetails config plus a per-payment storePaymentMethod flag.
    ...(input.context === "sessions"
      ? { storePaymentMethodMode: "askForConsent", recurringProcessingModel: "CardOnFile" }
      : {}),
    ...(input.context === "payments"
      ? paymentsRiskFields(billingAddress, deliveryAddress, nativeThreeDS)
      : sessionRiskFields(countryCode, nativeThreeDS)),
  };
}

// A refused payment leaves the session open: the shopper retries in it until
// it expires or a payment succeeds. 25 minutes is the owner's choice
// (2026-10-16); Adyen's default is an hour.
export const SESSION_VALIDITY_MS = 25 * 60 * 1000;

/** Builds the Checkout API /sessions payload for Digital Checkout. */
export function buildSessionRequest(input: {
  body: Record<string, unknown>;
  secrets: ProfileSecrets;
  order: OrderAggregate;
  origin: string;
  expiresAt: string;
}): Record<string, unknown> {
  return {
    ...requestBase({
      body: input.body,
      secrets: input.secrets,
      order: input.order,
      origin: input.origin,
      context: "sessions",
    }),
    expiresAt: input.expiresAt,
    metadata: playgroundMetadata("sessions"),
    ...(input.body.installments === true
      ? { installmentOptions: { card: { values: [2, 3, 4], preselectedValue: 2 } } }
      : {}),
    ...(Array.isArray(input.body.allowedPaymentMethods)
      ? { allowedPaymentMethods: input.body.allowedPaymentMethods }
      : {}),
  };
}

/** Builds the Checkout API /payments payload for Advanced and API-only flows. */
export function buildPaymentRequest(input: {
  body: Record<string, unknown>;
  secrets: ProfileSecrets;
  order: OrderAggregate;
  origin: string;
  paymentMethod: Record<string, unknown>;
  metadataFlow: "advanced" | "api-only";
  ip?: string;
  adyenOrder?: { orderData: string; pspReference: string };
  /** This payment's own amount: inside an Adyen order, its share of the order's total. */
  amount: Amount;
}): Record<string, unknown> {
  const isStoredPaymentMethod = Boolean(input.paymentMethod.storedPaymentMethodId);
  return {
    ...requestBase({
      body: input.body,
      secrets: input.secrets,
      order: input.order,
      origin: input.origin,
      context: "payments",
    }),
    ...forwardedStateData(input.body),
    metadata: playgroundMetadata(input.metadataFlow),
    paymentMethod: input.paymentMethod,
    browserInfo: input.body.browserInfo,
    origin: input.origin,
    ...(input.ip ? { shopperIP: input.ip } : {}),
    // Derive card-on-file interaction from the payload rather than trusting client labels.
    shopperInteraction:
      input.body.shopperInteraction ?? (isStoredPaymentMethod ? "ContAuth" : "Ecommerce"),
    ...(input.body.recurringProcessingModel
      ? { recurringProcessingModel: input.body.recurringProcessingModel }
      : isStoredPaymentMethod || input.body.storePaymentMethod
        ? { recurringProcessingModel: "CardOnFile" }
        : {}),
    // A stored method is already on file; re-storing it is rejected.
    ...(input.body.storePaymentMethod && !isStoredPaymentMethod
      ? { storePaymentMethod: true }
      : {}),
    ...(input.adyenOrder ? { order: input.adyenOrder, amount: input.amount } : {}),
    // Pair /payments with the /paymentMethods call that opened this checkout.
    ...(typeof input.body.shopperConversionId === "string"
      ? { shopperConversionId: conversionIdFrom(input.body.shopperConversionId) }
      : {}),
  };
}

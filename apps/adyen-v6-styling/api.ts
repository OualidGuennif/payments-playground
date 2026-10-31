// Spec: knowledge/components/adyen-v6-styling.md
import { AdyenTestClient } from "@suite/platform/adyen.ts";
import { buildCheckoutAddresses, normalizeCountryCode } from "@suite/platform/addresses.ts";
import { createPlatformContext, selectedSecrets } from "@suite/platform/base-api.ts";
import {
  currencyForCountry,
  defaultAmountForCountry,
  FALLBACK_COUNTRY,
  isSupportedMarket,
} from "@suite/platform/markets.ts";
import {
  buildLineItems,
  resolveShopperEmail,
  sessionRiskFields,
} from "@suite/platform/sessionContext.ts";
import { weeklyShopperReference } from "@suite/platform/shopper.ts";
import { INSTALLMENT_COUNTRIES } from "@suite/ui/paymentMethods.ts";

const context = createPlatformContext("styling");
export const api = context.api;

/** Market for a request body, falling back to a supported European default. */
function marketFrom(value: unknown): string {
  const country = normalizeCountryCode(value, FALLBACK_COUNTRY);
  return isSupportedMarket(country) ? country : FALLBACK_COUNTRY;
}

// Side lookup only, used to populate the "pre-select payment method" dropdown
// with the merchant's real available methods for a country, unrelated to
// (and doesn't affect) the /sessions call the Drop-in preview actually uses.
api.post("/api/styling/payment-methods", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { countryCode?: unknown };
  const countryCode = marketFrom(body.countryCode);
  const selected = await selectedSecrets(context, c.req.raw);
  if (!selected.secrets.merchantAccount) {
    return c.json({ error: "The server needs an Adyen TEST merchant account." }, 409);
  }
  // Amount/currency have to match the market: Adyen filters the available
  // methods on both, so a hardcoded EUR amount would return the euro-zone
  // list for every country.
  const response = await new AdyenTestClient(selected.secrets).paymentMethods({
    merchantAccount: selected.secrets.merchantAccount,
    countryCode,
    amount: {
      value: defaultAmountForCountry(countryCode),
      currency: currencyForCountry(countryCode),
    },
    channel: "Web",
  });
  const methods = (response as { paymentMethods?: Array<{ type: string; name: string }> })
    .paymentMethods ?? [];
  return c.json({ paymentMethods: methods.map(({ type, name }) => ({ type, name })) });
});

api.post("/api/styling/session", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    countryCode?: unknown;
    shopperLocale?: unknown;
    installments?: unknown;
  };
  const countryCode = marketFrom(body.countryCode);
  const shopperLocale = /^[a-z]{2}-[A-Z]{2}$/.test(String(body.shopperLocale))
    ? String(body.shopperLocale)
    : "en-US";
  // For the Sessions flow, Adyen only honors the installment plan baked into
  // the session token at creation time, a client-side
  // paymentMethodsConfiguration.card.installmentOptions override is ignored.
  const installmentsRequested = body.installments === true &&
    INSTALLMENT_COUNTRIES.includes(countryCode);
  const selected = await selectedSecrets(context, c.req.raw);
  if (!selected.secrets.merchantAccount || !selected.secrets.clientKey) {
    return c.json({
      error: "The server needs ADYEN_API_KEY, ADYEN_MERCHANT_ACCOUNT and a TEST client key.",
    }, 409);
  }
  const order = context.repository.createOrder({
    appId: "styling",
    flow: "v6-styling-dropin",
    amount: {
      value: defaultAmountForCountry(countryCode),
      currency: currencyForCountry(countryCode),
    },
  });
  const addresses = buildCheckoutAddresses({ countryCode });
  const request = {
    merchantAccount: selected.secrets.merchantAccount,
    amount: order.amount,
    reference: order.reference,
    countryCode,
    shopperLocale,
    shopperReference: weeklyShopperReference(),
    shopperEmail: resolveShopperEmail(),
    // Required for line-item-aware methods (Klarna and other BNPL) to be
    // considered eligible at all, without it they're silently excluded.
    lineItems: buildLineItems(order.amount),
    // Lets the shopper opt in to saving the card (shown as a checkbox in the
    // Card component) so the "save card" / cardOnFile UI can be previewed.
    storePaymentMethodMode: "askForConsent",
    recurringProcessingModel: "CardOnFile",
    channel: "Web",
    returnUrl: `${context.config.publicOrigin}/`,
    billingAddress: addresses.billingAddress,
    deliveryAddress: {
      ...addresses.deliveryAddress,
      firstName: "Test",
      lastName: "Shopper",
    },
    ...sessionRiskFields(countryCode),
    ...(installmentsRequested ? { installmentOptions: { card: { values: [1, 3, 5] } } } : {}),
  };
  const started = performance.now();
  try {
    const response = await new AdyenTestClient(selected.secrets).sessions(
      request,
      crypto.randomUUID(),
    );
    context.repository.recordApiCall({
      appId: "styling",
      correlationId: order.id,
      name: "Checkout API /sessions",
      method: "POST",
      endpoint: "https://checkout-test.adyen.com/v72/sessions",
      status: 200,
      durationMs: Math.round(performance.now() - started),
      request,
      response,
    });
    context.repository.createSession({
      orderId: order.id,
      kind: "v6-styling-dropin",
      adyenSessionId: String((response as { id?: string }).id ?? ""),
      state: "created",
      expiresAt: String((response as { expiresAt?: string }).expiresAt ?? ""),
    });
    return c.json({ correlationId: order.id, session: response }, 201);
  } catch (error) {
    context.repository.recordApiCall({
      appId: "styling",
      correlationId: order.id,
      name: "Checkout API /sessions",
      method: "POST",
      endpoint: "https://checkout-test.adyen.com/v72/sessions",
      status: 500,
      durationMs: Math.round(performance.now() - started),
      request,
      response: {},
      error: error instanceof Error ? error.message : "Session request failed.",
    });
    throw error;
  }
});

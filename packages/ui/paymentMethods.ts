// Spec: knowledge/components/ui-package.md
// Adyen Web reports a wallet's SDK failing to load (e.g. Apple Pay outside
// Safari/HTTPS, Google Pay without domain verification) through the same
// top-level onError as a real payment failure. Those are expected and
// shouldn't stop the whole Drop-in, only genuine payment/session errors
// should.
// CANCEL is the shopper closing a wallet sheet ("ApplePay UI dismissed") ,
// a normal thing to do, and never something to show as an error.
const NON_FATAL_ERROR_NAMES = new Set(["SCRIPT_ERROR", "SDK_ERROR", "CANCEL"]);

export function isNonFatalWalletError(cause: unknown): boolean {
  const name = (cause as { name?: unknown } | null)?.name;
  return typeof name === "string" && NON_FATAL_ERROR_NAMES.has(name);
}

// Credit card installments only make sense on these markets, kept as the
// single source of truth so the v6-styling playground's country-gated
// installments toggle stays aligned with what adyen-digital actually sends.
export const INSTALLMENT_COUNTRIES = ["BR", "MX", "JP"];

// Brazil requires a CPF/CNPJ (social security number) field on certain card
// payments, irrelevant everywhere else, so only gated on for BR.
export const SOCIAL_SECURITY_NUMBER_COUNTRIES = ["BR"];

export function installmentsConfiguration(countryCode: string): Record<string, unknown> {
  if (!INSTALLMENT_COUNTRIES.includes(countryCode.toUpperCase())) return {};
  return {
    installmentOptions: { card: { values: [1, 3, 5] } },
    showInstallmentAmounts: true,
  };
}

export function cardConfiguration(
  countryCode: string,
  options: { enableStoreDetails?: boolean } = {},
): Record<string, unknown> {
  const upperCountry = countryCode.toUpperCase();
  return {
    showBrandIcon: true,
    hasHolderName: true,
    holderNameRequired: true,
    billingAddressRequired: false,
    hideCVC: false,
    maskSecurityCode: false,
    // Sessions flow shows the "save card" checkbox on its own from the
    // session's storePaymentMethodMode, this only matters for the Advanced
    // flow, which owns the Card config directly with no session to drive it.
    ...(options.enableStoreDetails ? { enableStoreDetails: true } : {}),
    placeholders: {
      cardNumber: "1234 5678 9012 3456",
      expiryDate: "MM/YY",
      securityCodeThreeDigits: "123",
      securityCodeFourDigits: "1234",
      holderName: "J. Smith",
    },
    ...(SOCIAL_SECURITY_NUMBER_COUNTRIES.includes(upperCountry)
      ? { configuration: { socialSecurityNumberMode: "auto" } }
      : {}),
    ...installmentsConfiguration(countryCode),
  };
}

// The legacy playground's registered Google Pay Business Console merchant ID
// for this TEST account. GooglePay throws synchronously if `merchantId` is
// missing, regardless of profile, so this stays fixed across profiles the
// same way the legacy playground hardcoded it.
const GOOGLE_PAY_MERCHANT_ID = "0023022202";

/**
 * Mirrors the legacy playground's per-method Drop-in/Components configuration
 * (public/js/payment-methods/sessionFlow/dropin.js) so every payment method
 * renders with the same holder-name, brand-icon and widget behaviour. Unlike
 * the legacy file, googlepay's gatewayMerchantId is derived from the active
 * TEST profile's own merchant account instead of being hardcoded.
 */
export function paymentMethodsConfiguration(
  countryCode: string,
  merchantAccount?: string | null,
  options: { enableStoreDetails?: boolean } = {},
): Record<string, unknown> {
  return {
    card: cardConfiguration(countryCode, options),
    scheme: cardConfiguration(countryCode, options),
    applepay: { emailRequired: true },
    googlepay: {
      buttonType: "checkout",
      allowedCardNetworks: ["MASTERCARD", "VISA", "AMEX"],
      emailRequired: true,
      configuration: {
        merchantId: GOOGLE_PAY_MERCHANT_ID,
        ...(merchantAccount ? { gatewayMerchantId: merchantAccount } : {}),
      },
    },
    paypal: { style: { layout: "vertical", color: "black" } },
    klarna: { useKlarnaWidget: false },
    klarna_account: { useKlarnaWidget: false },
    klarna_paynow: { useKlarnaWidget: false },
    ideal: { showImage: true },
    sepadirectdebit: { showImage: true },
  };
}

// Card options (CardConfiguration) and the card configuration objects.
import {
  INSTALLMENT_COUNTRIES,
  SOCIAL_SECURITY_NUMBER_COUNTRIES,
} from "@suite/ui/paymentMethods.ts";
import { secureStyleObject, type SecureStyles } from "./secured-fields.ts";

export type SocialSecurityNumberMode = "auto" | "show" | "hide";
export type BillingAddressMode = "full" | "partial" | "none";

/** Adyen's own address schema, used for billingAddressRequiredFields. */
export const ADDRESS_FIELDS: [string, string][] = [
  ["street", "Street"],
  ["houseNumberOrName", "House number"],
  ["postalCode", "Postal code"],
  ["city", "City"],
  ["stateOrProvince", "State / province"],
  ["country", "Country"],
];

export type PlaceholderKey =
  | "holderName"
  | "cardNumber"
  | "expiryDate"
  | "expiryMonth"
  | "expiryYear"
  | "securityCodeThreeDigits"
  | "securityCodeFourDigits"
  | "password";

export const PLACEHOLDER_FIELDS: [PlaceholderKey, string, string][] = [
  ["holderName", "holderName", "J. Smith"],
  ["cardNumber", "cardNumber", "1234 5678 9012 3456"],
  ["expiryDate", "expiryDate", "MM/YY"],
  ["expiryMonth", "expiryMonth", "MM"],
  ["expiryYear", "expiryYear", "YY"],
  ["securityCodeThreeDigits", "securityCodeThreeDigits", "123"],
  ["securityCodeFourDigits", "securityCodeFourDigits", "1234"],
  ["password", "password", "Korean cards only"],
];

export interface CardOptions {
  hasHolderName: boolean;
  holderNameRequired: boolean;
  positionHolderNameOnTop: boolean;
  holderNamePrefill: string;
  hideCVC: boolean;
  maskSecurityCode: boolean;
  placeholders: Partial<Record<PlaceholderKey, string>>;
  billingAddressRequired: boolean;
  billingAddressMode: BillingAddressMode;
  billingAddressAllowedCountries: string[];
  billingAddressRequiredFields: string[];
  autoFocus: boolean;
  keypadFix: boolean;
  legacyInputMode: boolean;
  disableIOSArrowKeys: boolean;
  exposeExpiryDate: boolean;
  minimumExpiryDate: string;
  socialSecurityNumberMode: SocialSecurityNumberMode;
  showInstallmentAmounts: boolean;
  disclaimerEnabled: boolean;
  disclaimerMessage: string;
  disclaimerLinkText: string;
  disclaimerLink: string;
}

export const DEFAULT_CARD: CardOptions = {
  hasHolderName: true,
  holderNameRequired: true,
  positionHolderNameOnTop: false,
  holderNamePrefill: "",
  hideCVC: false,
  maskSecurityCode: false,
  placeholders: {},
  billingAddressRequired: false,
  billingAddressMode: "full",
  billingAddressAllowedCountries: [],
  billingAddressRequiredFields: [],
  autoFocus: true,
  keypadFix: true,
  legacyInputMode: false,
  disableIOSArrowKeys: true,
  exposeExpiryDate: false,
  minimumExpiryDate: "",
  socialSecurityNumberMode: "auto",
  showInstallmentAmounts: false,
  disclaimerEnabled: false,
  disclaimerMessage: "",
  disclaimerLinkText: "",
  disclaimerLink: "",
};

// Adyen's own DisclaimerMessage component silently renders nothing at all
// (not even the message text) unless every url passed to it is a valid
// http(s) URL, an empty or missing link string means the whole disclaimer
// disappears, message included. Guard against sending a config that would
// silently vanish.
export function isValidHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isValidExpiryDate(value: string): boolean {
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(value);
}

function disclaimerMessageField(card: CardOptions) {
  if (!card.disclaimerEnabled || !card.disclaimerMessage || !isValidHttpUrl(card.disclaimerLink)) {
    return {};
  }
  return {
    disclaimerMessage: {
      message: card.disclaimerMessage,
      linkText: card.disclaimerLinkText,
      link: card.disclaimerLink,
    },
  };
}

function placeholdersField(card: CardOptions) {
  const set = Object.entries(card.placeholders).filter(([, value]) => value);
  return set.length > 0 ? { placeholders: Object.fromEntries(set) } : {};
}

/** Options that apply to a re-entered CVC as much as to a full card form. */
function sharedFieldOptions(styles: SecureStyles, card: CardOptions) {
  return {
    styles: secureStyleObject(styles),
    hideCVC: card.hideCVC,
    maskSecurityCode: card.maskSecurityCode,
    autoFocus: card.autoFocus,
    keypadFix: card.keypadFix,
    legacyInputMode: card.legacyInputMode,
    disableIOSArrowKeys: card.disableIOSArrowKeys,
    ...placeholdersField(card),
    ...disclaimerMessageField(card),
  };
}

export function cardConfigObject(styles: SecureStyles, card: CardOptions, country: string) {
  const upperCountry = country.toUpperCase();
  return {
    ...sharedFieldOptions(styles, card),
    hasHolderName: card.hasHolderName,
    holderNameRequired: card.hasHolderName && card.holderNameRequired,
    positionHolderNameOnTop: card.positionHolderNameOnTop,
    ...(card.hasHolderName && card.holderNamePrefill
      ? { data: { holderName: card.holderNamePrefill } }
      : {}),
    billingAddressRequired: card.billingAddressRequired,
    ...(card.billingAddressRequired
      ? {
          billingAddressMode: card.billingAddressMode,
          ...(card.billingAddressAllowedCountries.length > 0
            ? { billingAddressAllowedCountries: card.billingAddressAllowedCountries }
            : {}),
          ...(card.billingAddressRequiredFields.length > 0
            ? { billingAddressRequiredFields: card.billingAddressRequiredFields }
            : {}),
        }
      : {}),
    exposeExpiryDate: card.exposeExpiryDate,
    ...(isValidExpiryDate(card.minimumExpiryDate)
      ? { minimumExpiryDate: card.minimumExpiryDate }
      : {}),
    ...(SOCIAL_SECURITY_NUMBER_COUNTRIES.includes(upperCountry)
      ? { configuration: { socialSecurityNumberMode: card.socialSecurityNumberMode } }
      : {}),
    // installmentOptions itself is NOT set here: for the Sessions flow, Adyen
    // only honors the installment plan baked into the session token at
    // creation time (sent server-side in /api/styling/session, automatically
    // for BR/MX/JP), a client-side override here is silently ignored.
    // showInstallmentAmounts is a pure Component display toggle, so it's
    // still set client-side.
    ...(INSTALLMENT_COUNTRIES.includes(upperCountry)
      ? { showInstallmentAmounts: card.showInstallmentAmounts }
      : {}),
  };
}

// storedCard only ever re-collects a CVC, it never renders a holder name,
// billing address or social security number field. Applying
// holderNameRequired/billingAddressRequired to it anyway makes the
// Component report isValid: false with no visible field to fix, so
// clicking "Pay" on a saved card silently does nothing. Everything that
// applies to the CVC field it does render is forwarded.
export function storedCardConfigObject(styles: SecureStyles, card: CardOptions) {
  return sharedFieldOptions(styles, card);
}

/**
 * Gift cards and Bancontact type into the same secured-field iframes as the
 * card. Without the same styles their digits keep Adyen's dark default,
 * unreadable on a dark theme. Giftcard hands its props, styles included, to
 * the iframes even though GiftCardConfiguration does not declare them.
 */
export function securedFieldMethodConfigObjects(styles: SecureStyles) {
  const objectStyles = secureStyleObject(styles);
  if (Object.keys(objectStyles).length === 0) return {};
  // Widened on purpose: the type would reject the one prop that matters here.
  const giftcard: Record<string, unknown> = { styles: objectStyles };
  return { giftcard, bcmc: { styles: objectStyles } };
}

// Spec: knowledge/components/adyen-digital.md
// Per-method configuration for Drop-in and the single Components.
import { paymentMethodsConfiguration } from "@suite/ui/paymentMethods.ts";
import type { Theme } from "@suite/ui/theme.ts";
import { securedFieldStyles } from "./flow-helpers.ts";

// Card-only settings. Adyen Web reads these from the card's own
// configuration and ignores them, with a console warning, at the
// AdyenCheckout level.
export function methodsConfiguration(input: {
  country: string;
  merchantAccount?: string;
  storeDetails: boolean;
  theme: Theme;
  addCallback(name: string, payload: unknown): void;
}): Record<string, unknown> {
  const configuration = paymentMethodsConfiguration(input.country, input.merchantAccount, {
    enableStoreDetails: input.storeDetails,
  });
  const styles = securedFieldStyles(input.theme);
  const cardOptions = {
    onBinLookup: (data: unknown) => input.addCallback("onBinLookup", data),
    onBinValue: (data: unknown) => input.addCallback("onBinValue", data),
    onBrand: (data: unknown) => input.addCallback("onBrand", data),
    ...(styles ? { styles } : {}),
  };
  for (const type of ["card", "scheme", "storedCard"]) {
    configuration[type] = { ...(configuration[type] as Record<string, unknown>), ...cardOptions };
  }
  // Gift cards, meal vouchers and Bancontact type into the same secured
  // field iframes: without these colours their digits stay dark on the
  // dark theme. Giftcard hands its props to the iframes, styles included.
  if (styles) {
    for (const type of [
      "giftcard",
      "bcmc",
      "mealVoucher_FR_groupeup",
      "mealVoucher_FR_natixis",
      "mealVoucher_FR_sodexo",
    ]) {
      configuration[type] = { ...(configuration[type] as Record<string, unknown>), styles };
    }
  }
  return configuration;
}

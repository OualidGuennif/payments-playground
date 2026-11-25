// What the playground hands to Drop-in: every option area merged into one configuration.
import {
  cardConfigObject,
  type CardOptions,
  securedFieldMethodConfigObjects,
  storedCardConfigObject,
} from "./card.ts";
import type { NativeOptions } from "./dropin.ts";
import type { SecureStyles } from "./secured-fields.ts";
import { walletConfigObjects, type WalletOptions } from "./wallets.ts";

export function dropinProps(
  native: NativeOptions,
  styles: SecureStyles,
  card: CardOptions,
  country: string,
  wallets: WalletOptions,
) {
  return {
    openFirstPaymentMethod: native.openFirstPaymentMethod,
    openFirstStoredPaymentMethod: native.openFirstStoredPaymentMethod,
    ...(native.openPaymentMethodType
      ? { openPaymentMethod: { type: native.openPaymentMethodType } }
      : {}),
    instantPaymentTypes: native.instantPaymentTypes,
    showPaymentMethods: native.showPaymentMethods,
    showStoredPaymentMethods: native.showStoredPaymentMethods,
    showRadioButton: native.showRadioButton,
    disableFinalAnimation: native.disableFinalAnimation,
    paymentMethodsConfiguration: {
      card: cardConfigObject(styles, card, country),
      storedCard: storedCardConfigObject(styles, card),
      ...securedFieldMethodConfigObjects(styles),
      ...walletConfigObjects(wallets),
    },
  };
}

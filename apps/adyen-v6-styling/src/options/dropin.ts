// Drop-in options (DropinConfiguration) a merchant may set.

export type InstantPaymentType = "applepay" | "googlepay";

export interface NativeOptions {
  openFirstPaymentMethod: boolean;
  openFirstStoredPaymentMethod: boolean;
  openPaymentMethodType: string;
  instantPaymentTypes: InstantPaymentType[];
  showPaymentMethods: boolean;
  showStoredPaymentMethods: boolean;
  showRadioButton: boolean;
  disableFinalAnimation: boolean;
}

export const DEFAULT_NATIVE: NativeOptions = {
  openFirstPaymentMethod: false,
  openFirstStoredPaymentMethod: false,
  openPaymentMethodType: "",
  instantPaymentTypes: ["applepay", "googlepay"],
  showPaymentMethods: true,
  showStoredPaymentMethods: true,
  showRadioButton: false,
  disableFinalAnimation: false,
};

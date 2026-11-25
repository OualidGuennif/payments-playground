// Spec: knowledge/components/adyen-v6-styling.md
import { Field } from "@suite/ui/components.tsx";
import { OptionGroup, SwitchRow } from "../OptionFields.tsx";
import type { ComponentsPanelProps } from "./ComponentsPanel.tsx";

/** DropinConfiguration: the payment method list. */
export function DropinGroup(
  props: Pick<
    ComponentsPanelProps,
    | "nativeOptions"
    | "showDonation"
    | "setShowDonation"
    | "availableMethods"
    | "updateNative"
    | "toggleInstantPaymentType"
    | "groupOpen"
    | "setGroupOpen"
  >,
) {
  const {
    nativeOptions,
    showDonation,
    setShowDonation,
    availableMethods,
    updateNative,
    toggleInstantPaymentType,
    groupOpen,
    setGroupOpen,
  } = props;
  return (
    <OptionGroup
      title="Drop-in"
      hint="DropinConfiguration: how the payment method list itself behaves."
      open={groupOpen("config:Drop-in")}
      onToggle={(open) => setGroupOpen("config:Drop-in", open)}
    >
      <SwitchRow
        label="Show payment methods"
        hint="showPaymentMethods"
        checked={nativeOptions.showPaymentMethods}
        onChange={(value) => updateNative("showPaymentMethods", value)}
      />
      <SwitchRow
        label="Show stored payment methods"
        hint="showStoredPaymentMethods"
        checked={nativeOptions.showStoredPaymentMethods}
        onChange={(value) => updateNative("showStoredPaymentMethods", value)}
      />
      <SwitchRow
        label="Open first payment method"
        hint="openFirstPaymentMethod"
        checked={nativeOptions.openFirstPaymentMethod}
        onChange={(value) => updateNative("openFirstPaymentMethod", value)}
      />
      <SwitchRow
        label="Open first stored method"
        hint="openFirstStoredPaymentMethod, takes priority over the toggle above"
        checked={nativeOptions.openFirstStoredPaymentMethod}
        onChange={(value) => updateNative("openFirstStoredPaymentMethod", value)}
      />
      <SwitchRow
        label="Show radio buttons"
        hint="showRadioButton"
        checked={nativeOptions.showRadioButton}
        onChange={(value) => updateNative("showRadioButton", value)}
      />
      <SwitchRow
        label="Skip final animation"
        hint="disableFinalAnimation"
        checked={nativeOptions.disableFinalAnimation}
        onChange={(value) => updateNative("disableFinalAnimation", value)}
      />
      <SwitchRow
        label="Adyen Giving"
        hint={
          "donation.autoMount, offers a donation once the payment is done, " +
          "when the account has Adyen Giving enabled. Rebuilds the session."
        }
        checked={showDonation}
        onChange={setShowDonation}
      />
      <SwitchRow
        label="Apple Pay on top"
        hint="instantPaymentTypes"
        checked={nativeOptions.instantPaymentTypes.includes("applepay")}
        onChange={(value) => toggleInstantPaymentType("applepay", value)}
      />
      <SwitchRow
        label="Google Pay on top"
        hint="instantPaymentTypes"
        checked={nativeOptions.instantPaymentTypes.includes("googlepay")}
        onChange={(value) => toggleInstantPaymentType("googlepay", value)}
      />
      <Field label="Pre-select method" htmlFor="native-open-type">
        <select
          id="native-open-type"
          value={nativeOptions.openPaymentMethodType}
          onChange={(event) => updateNative("openPaymentMethodType", event.currentTarget.value)}
        >
          <option value="">None</option>
          {availableMethods.map(({ type, name }) => (
            <option key={type} value={type}>
              {name}
            </option>
          ))}
        </select>
        <small>openPaymentMethod, takes priority over the two toggles above.</small>
      </Field>
    </OptionGroup>
  );
}

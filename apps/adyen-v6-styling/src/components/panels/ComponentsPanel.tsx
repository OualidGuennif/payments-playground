// Spec: knowledge/components/adyen-v6-styling.md
// A tab of the styling panel. It owns no state: the island stays the single source of
// truth, so switching tabs keeps what you have set.
import { cardConfigObject } from "../../options/card.ts";
import { walletConfigObjects } from "../../options/wallets.ts";
import type { CardOptions, PlaceholderKey } from "../../options/card.ts";
import type { InstantPaymentType, NativeOptions } from "../../options/dropin.ts";
import type { SecureStyles } from "../../options/secured-fields.ts";
import type { WalletOptions } from "../../options/wallets.ts";
import type { AvailableMethod } from "../styling-data.ts";
import { CardFieldsGroup, CardFormGroups } from "./CardGroups.tsx";
import { DropinGroup } from "./DropinGroup.tsx";
import { RawOutput } from "./RawOutput.tsx";
import { WalletGroups } from "./WalletGroups.tsx";

export type ComponentsPanelProps = {
  nativeOptions: NativeOptions;
  cardOptions: CardOptions;
  walletOptions: WalletOptions;
  secureStyles: SecureStyles;
  showDonation: boolean;
  setShowDonation: (value: boolean) => void;
  availableMethods: AvailableMethod[];
  country: string;
  updateNative: <K extends keyof NativeOptions>(key: K, value: NativeOptions[K]) => void;
  updateCard: <K extends keyof CardOptions>(key: K, value: CardOptions[K]) => void;
  updateWallet: <K extends keyof WalletOptions>(key: K, value: WalletOptions[K]) => void;
  updatePlaceholder: (key: PlaceholderKey, value: string) => void;
  toggleInstantPaymentType: (type: InstantPaymentType, enabled: boolean) => void;
  groupOpen: (key: string) => boolean;
  setGroupOpen: (key: string, open: boolean) => void;
};

/** Drop-in, card, wallet and placeholder options, plus their JSON export. */
export function ComponentsPanel(props: ComponentsPanelProps) {
  const { cardOptions, walletOptions, secureStyles, country } = props;
  return (
    <>
      <DropinGroup {...props} />
      <CardFieldsGroup {...props} />
      <WalletGroups {...props} />
      <CardFormGroups {...props} />
      <RawOutput
        content={JSON.stringify(
          {
            card: cardConfigObject(secureStyles, cardOptions, country),
            ...walletConfigObjects(walletOptions),
          },
          null,
          2,
        )}
        filename="adyen-card-config.json"
        mime="application/json"
      />
    </>
  );
}

// Spec: knowledge/components/adyen-v6-styling.md
import { Field } from "@suite/ui/components.tsx";
import { OptionGroup, SwitchRow } from "../OptionFields.tsx";
import {
  APPLE_PAY_BUTTON_COLORS,
  APPLE_PAY_BUTTON_TYPES,
  APPLE_PAY_RADIUS_VARIABLE,
  GOOGLE_PAY_BUTTON_COLORS,
  GOOGLE_PAY_BUTTON_TYPES,
  PAYPAL_COLORS,
  PAYPAL_LABELS,
  PAYPAL_SHAPES,
  walletSetCount,
} from "../../options/wallets.ts";
import type {
  ApplePayButtonColor,
  ApplePayButtonType,
  GooglePayButtonColor,
  GooglePayButtonType,
  PayPalColor,
  PayPalLabel,
  PayPalShape,
} from "../../options/wallets.ts";
import { WALLET_HINT } from "../styling-data.ts";
import type { ComponentsPanelProps } from "./ComponentsPanel.tsx";

/** Apple Pay, Google Pay and PayPal button options. */
export function WalletGroups(
  props: Pick<
    ComponentsPanelProps,
    "walletOptions" | "updateWallet" | "groupOpen" | "setGroupOpen"
  >,
) {
  const { walletOptions, updateWallet, groupOpen, setGroupOpen } = props;
  return (
    <>
      <OptionGroup
        title="Apple Pay"
        hint={WALLET_HINT}
        count={walletSetCount(walletOptions, "applePay")}
        open={groupOpen("config:Apple Pay")}
        onToggle={(open) => setGroupOpen("config:Apple Pay", open)}
      >
        <Field label="Button type" htmlFor="applepay-type">
          <select
            id="applepay-type"
            value={walletOptions.applePayButtonType}
            onChange={(event) =>
              updateWallet("applePayButtonType", event.currentTarget.value as ApplePayButtonType)
            }
          >
            <option value="">Adyen default (buy)</option>
            {APPLE_PAY_BUTTON_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>applepay.buttonType, the wording Apple prints on the button.</small>
        </Field>
        <Field label="Button colour" htmlFor="applepay-color">
          <select
            id="applepay-color"
            value={walletOptions.applePayButtonColor}
            onChange={(event) =>
              updateWallet("applePayButtonColor", event.currentTarget.value as ApplePayButtonColor)
            }
          >
            <option value="">Adyen default (black)</option>
            {APPLE_PAY_BUTTON_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>applepay.buttonColor</small>
        </Field>
        <Field label="Total price label" htmlFor="applepay-total-label">
          <input
            id="applepay-total-label"
            type="text"
            value={walletOptions.applePayTotalPriceLabel}
            placeholder="Your store name"
            onChange={(event) => updateWallet("applePayTotalPriceLabel", event.currentTarget.value)}
          />
          <small>
            applepay.totalPriceLabel, the name shown beside the total on the Apple Pay sheet.
          </small>
        </Field>
        <Field label="Corner radius" htmlFor="applepay-radius">
          <input
            id="applepay-radius"
            type="text"
            value={walletOptions.applePayButtonRadius}
            placeholder="4px"
            onChange={(event) => updateWallet("applePayButtonRadius", event.currentTarget.value)}
          />
          <small>
            {APPLE_PAY_RADIUS_VARIABLE} , Apple's own property, so this one ships in the stylesheet
            rather than the config. A bare number is read as pixels; 9999px gives a pill.
          </small>
        </Field>
      </OptionGroup>
      <OptionGroup
        title="Google Pay"
        hint={WALLET_HINT}
        count={walletSetCount(walletOptions, "googlePay")}
        open={groupOpen("config:Google Pay")}
        onToggle={(open) => setGroupOpen("config:Google Pay", open)}
      >
        <Field label="Button type" htmlFor="googlepay-type">
          <select
            id="googlepay-type"
            value={walletOptions.googlePayButtonType}
            onChange={(event) =>
              updateWallet("googlePayButtonType", event.currentTarget.value as GooglePayButtonType)
            }
          >
            <option value="">Adyen default (buy)</option>
            {GOOGLE_PAY_BUTTON_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>googlepay.buttonType</small>
        </Field>
        <Field label="Button colour" htmlFor="googlepay-color">
          <select
            id="googlepay-color"
            value={walletOptions.googlePayButtonColor}
            onChange={(event) =>
              updateWallet(
                "googlePayButtonColor",
                event.currentTarget.value as GooglePayButtonColor,
              )
            }
          >
            <option value="">Adyen default (default)</option>
            {GOOGLE_PAY_BUTTON_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>googlepay.buttonColor, "default" follows the shopper's theme.</small>
        </Field>
        <Field label="Corner radius" htmlFor="googlepay-radius">
          <input
            id="googlepay-radius"
            type="text"
            inputMode="numeric"
            value={walletOptions.googlePayButtonRadius}
            placeholder="4"
            onChange={(event) => updateWallet("googlePayButtonRadius", event.currentTarget.value)}
          />
          <small>googlepay.buttonRadius, in pixels.</small>
        </Field>
      </OptionGroup>
      <OptionGroup
        title="PayPal"
        hint={WALLET_HINT}
        count={walletSetCount(walletOptions, "paypal")}
        open={groupOpen("config:PayPal")}
        onToggle={(open) => setGroupOpen("config:PayPal", open)}
      >
        <Field label="Button colour" htmlFor="paypal-color">
          <select
            id="paypal-color"
            value={walletOptions.paypalColor}
            onChange={(event) =>
              updateWallet("paypalColor", event.currentTarget.value as PayPalColor)
            }
          >
            <option value="">Adyen default (gold)</option>
            {PAYPAL_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>paypal.style.color</small>
        </Field>
        <Field label="Button shape" htmlFor="paypal-shape">
          <select
            id="paypal-shape"
            value={walletOptions.paypalShape}
            onChange={(event) =>
              updateWallet("paypalShape", event.currentTarget.value as PayPalShape)
            }
          >
            <option value="">Adyen default (rect)</option>
            {PAYPAL_SHAPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>paypal.style.shape</small>
        </Field>
        <Field label="Button label" htmlFor="paypal-label">
          <select
            id="paypal-label"
            value={walletOptions.paypalLabel}
            onChange={(event) =>
              updateWallet("paypalLabel", event.currentTarget.value as PayPalLabel)
            }
          >
            <option value="">Adyen default (paypal)</option>
            {PAYPAL_LABELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <small>paypal.style.label</small>
        </Field>
        <SwitchRow
          label="Hide Pay Later button"
          hint={
            "blockPayPalPayLaterButton, PayPal adds a second, instalments " +
            "button when the amount and market qualify."
          }
          checked={walletOptions.paypalBlockPayLater}
          onChange={(value) => updateWallet("paypalBlockPayLater", value)}
        />
      </OptionGroup>
    </>
  );
}

// Spec: knowledge/components/adyen-v6-styling.md
import { useState } from "preact/hooks";
import { Field } from "@suite/ui/components.tsx";
import {
  INSTALLMENT_COUNTRIES,
  SOCIAL_SECURITY_NUMBER_COUNTRIES,
} from "@suite/ui/paymentMethods.ts";
import { CheckboxDropdown, OptionGroup, OptionRow, SwitchRow } from "./OptionFields.tsx";
import {
  ADDRESS_FIELDS,
  ADYEN_CSS_URL,
  ADYEN_WEB_VERSION,
  APPLE_PAY_BUTTON_COLORS,
  APPLE_PAY_BUTTON_TYPES,
  APPLE_PAY_RADIUS_VARIABLE,
  cardConfigObject,
  CSS_RULE_SPECS,
  CSS_TOKEN_GROUPS,
  CSS_TOKEN_SPECS,
  cssRuleSetCount,
  cssTokenSetCount,
  DEFAULT_CSS_RULES,
  GOOGLE_PAY_BUTTON_COLORS,
  GOOGLE_PAY_BUTTON_TYPES,
  isValidExpiryDate,
  isValidHttpUrl,
  PAYPAL_COLORS,
  PAYPAL_LABELS,
  PAYPAL_SHAPES,
  PLACEHOLDER_FIELDS,
  SECURE_GROUPS,
  SECURE_PROPERTY_SPECS,
  SECURE_STATE_META,
  SECURE_STATES,
  securedFieldMethodConfigObjects,
  secureSetCount,
  storedCardConfigObject,
  walletConfigObjects,
  walletSetCount,
} from "./adyenOptions.ts";
import type {
  ApplePayButtonColor,
  ApplePayButtonType,
  BillingAddressMode,
  CardOptions,
  CssRules,
  CssTokens,
  GooglePayButtonColor,
  GooglePayButtonType,
  InstantPaymentType,
  NativeOptions,
  PayPalColor,
  PayPalLabel,
  PayPalShape,
  PlaceholderKey,
  SecureProperty,
  SecureState,
  SecureStyles,
  SocialSecurityNumberMode,
  WalletOptions,
} from "./adyenOptions.ts";
import { COUNTRY_ITEMS, PLACEHOLDERS_HINT, RULES_HINT, WALLET_HINT } from "./styling-data.ts";
import type { AvailableMethod } from "./styling-data.ts";
import { download } from "./styling-persistence.ts";

/**
 * The three tabs of the styling panel, each rendered from the island's state
 * and reporting every change back through the callbacks it is given. They own
 * no state of their own, so the island stays the single source of truth and
 * switching tabs keeps what you have set.
 */

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 21h16"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function RawOutput(
  props: { content: string; filename: string; mime: string },
) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="raw-output">
      <div class="raw-output__header">
        <span>Raw output</span>
        <div class="raw-output__actions">
          <button
            type="button"
            class="button button--quiet button--small"
            onClick={() => {
              navigator.clipboard?.writeText(props.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }).catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            class="button button--quiet button--small raw-output__icon-btn"
            aria-label="Download"
            title="Download"
            onClick={() => download(props.filename, props.content, props.mime)}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
      <pre class="code-block raw-output__pre">{props.content}</pre>
    </div>
  );
}

/** Secured-field styles: the four states of Adyen's card iframe inputs. */
export function FieldStylesPanel(props: {
  secureStyles: SecureStyles;
  secureState: SecureState;
  setSecureState: (state: SecureState) => void;
  updateSecure: (property: SecureProperty, value: string) => void;
  cardOptions: CardOptions;
  country: string;
  groupOpen: (key: string) => boolean;
  setGroupOpen: (key: string, open: boolean) => void;
}) {
  const {
    secureStyles,
    secureState,
    setSecureState,
    updateSecure,
    cardOptions,
    country,
    groupOpen,
    setGroupOpen,
  } = props;
  return (
    <>
      <p class="css-note">
        The card number, expiry date and security code are rendered inside Adyen-hosted iframes, so
        no page CSS can reach them: they are styled only through this object. All{" "}
        {SECURE_PROPERTY_SPECS.length}{" "}
        properties Adyen accepts are below, for each of its four states.
      </p>
      <div class="styling-segmented" role="tablist" aria-label="Field state">
        {SECURE_STATES.map((state) => {
          const count = secureSetCount(secureStyles, state);
          return (
            <button
              key={state}
              type="button"
              role="tab"
              aria-selected={secureState === state}
              onClick={() => setSecureState(state)}
            >
              {SECURE_STATE_META[state].label}
              {count ? <span class="styling-segmented__count">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <p class="option-group__hint">{SECURE_STATE_META[secureState].hint}</p>
      {SECURE_GROUPS.map((group) => {
        const specs = SECURE_PROPERTY_SPECS
          .filter((spec) => spec.group === group);
        if (specs.length === 0) return null;
        const key = `secure:${group}`;
        return (
          <OptionGroup
            key={key}
            title={group}
            count={secureSetCount(secureStyles, secureState, group)}
            open={groupOpen(key)}
            onToggle={(open) => setGroupOpen(key, open)}
          >
            {specs.map((spec) => (
              <OptionRow
                key={spec.property}
                id={`secure-${secureState}-${spec.property}`}
                label={spec.label}
                hint={spec.hint}
                spec={spec}
                value={secureStyles[secureState][spec.property] ?? ""}
                onChange={(value) => updateSecure(spec.property, value)}
              />
            ))}
          </OptionGroup>
        );
      })}
      <RawOutput
        content={JSON.stringify(
          {
            card: cardConfigObject(secureStyles, cardOptions, country),
            storedCard: storedCardConfigObject(secureStyles, cardOptions),
            ...securedFieldMethodConfigObjects(secureStyles),
          },
          null,
          2,
        )}
        filename="adyen-styling-config.json"
        mime="application/json"
      />
    </>
  );
}

/** Drop-in, card, wallet and placeholder options, plus their JSON export. */
export function ComponentsPanel(props: {
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
}) {
  const {
    nativeOptions,
    cardOptions,
    walletOptions,
    secureStyles,
    showDonation,
    setShowDonation,
    availableMethods,
    country,
    updateNative,
    updateCard,
    updateWallet,
    updatePlaceholder,
    toggleInstantPaymentType,
    groupOpen,
    setGroupOpen,
  } = props;
  const installmentMarket = INSTALLMENT_COUNTRIES.includes(country);
  const socialSecurityMarket = SOCIAL_SECURITY_NUMBER_COUNTRIES.includes(country);
  return (
    <>
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
          hint={"donation.autoMount, offers a donation once the payment is done, " +
            "when the account has Adyen Giving enabled. Rebuilds the session."}
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
              <option key={type} value={type}>{name}</option>
            ))}
          </select>
          <small>openPaymentMethod, takes priority over the two toggles above.</small>
        </Field>
      </OptionGroup>
      <OptionGroup
        title="Card fields"
        hint="Which fields the card form renders, and how."
        open={groupOpen("config:Card fields")}
        onToggle={(open) => setGroupOpen("config:Card fields", open)}
      >
        <SwitchRow
          label="Show holder name"
          hint="hasHolderName"
          checked={cardOptions.hasHolderName}
          onChange={(value) => updateCard("hasHolderName", value)}
        />
        <SwitchRow
          label="Holder name required"
          hint="holderNameRequired"
          checked={cardOptions.holderNameRequired}
          disabled={!cardOptions.hasHolderName}
          onChange={(value) => updateCard("holderNameRequired", value)}
        />
        <SwitchRow
          label="Holder name on top"
          hint="positionHolderNameOnTop"
          checked={cardOptions.positionHolderNameOnTop}
          disabled={!cardOptions.hasHolderName}
          onChange={(value) => updateCard("positionHolderNameOnTop", value)}
        />
        <Field label="Prefill holder name" htmlFor="card-holder-prefill">
          <input
            id="card-holder-prefill"
            type="text"
            value={cardOptions.holderNamePrefill}
            placeholder="J. Smith"
            disabled={!cardOptions.hasHolderName}
            onInput={(event) => updateCard("holderNamePrefill", event.currentTarget.value)}
          />
          <small>data.holderName</small>
        </Field>
        <SwitchRow
          label="Hide CVC field"
          hint="hideCVC"
          checked={cardOptions.hideCVC}
          onChange={(value) => updateCard("hideCVC", value)}
        />
        <SwitchRow
          label="Mask security code"
          hint="maskSecurityCode"
          checked={cardOptions.maskSecurityCode}
          onChange={(value) => updateCard("maskSecurityCode", value)}
        />
      </OptionGroup>
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
              updateWallet(
                "applePayButtonType",
                event.currentTarget.value as ApplePayButtonType,
              )}
          >
            <option value="">Adyen default (buy)</option>
            {APPLE_PAY_BUTTON_TYPES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <small>applepay.buttonType, the wording Apple prints on the button.</small>
        </Field>
        <Field label="Button colour" htmlFor="applepay-color">
          <select
            id="applepay-color"
            value={walletOptions.applePayButtonColor}
            onChange={(event) =>
              updateWallet(
                "applePayButtonColor",
                event.currentTarget.value as ApplePayButtonColor,
              )}
          >
            <option value="">Adyen default (black)</option>
            {APPLE_PAY_BUTTON_COLORS.map((value) => (
              <option key={value} value={value}>{value}</option>
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
            onInput={(event) => updateWallet("applePayTotalPriceLabel", event.currentTarget.value)}
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
            onInput={(event) => updateWallet("applePayButtonRadius", event.currentTarget.value)}
          />
          <small>
            {APPLE_PAY_RADIUS_VARIABLE}{" "}
            , Apple's own property, so this one ships in the stylesheet rather than the config. A
            bare number is read as pixels; 9999px gives a pill.
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
            onChange={(event) => updateWallet(
              "googlePayButtonType",
              event.currentTarget.value as GooglePayButtonType,
            )}
          >
            <option value="">Adyen default (buy)</option>
            {GOOGLE_PAY_BUTTON_TYPES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <small>googlepay.buttonType</small>
        </Field>
        <Field label="Button colour" htmlFor="googlepay-color">
          <select
            id="googlepay-color"
            value={walletOptions.googlePayButtonColor}
            onChange={(event) => updateWallet(
              "googlePayButtonColor",
              event.currentTarget.value as GooglePayButtonColor,
            )}
          >
            <option value="">Adyen default (default)</option>
            {GOOGLE_PAY_BUTTON_COLORS.map((value) => (
              <option key={value} value={value}>{value}</option>
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
            onInput={(event) => updateWallet("googlePayButtonRadius", event.currentTarget.value)}
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
              updateWallet("paypalColor", event.currentTarget.value as PayPalColor)}
          >
            <option value="">Adyen default (gold)</option>
            {PAYPAL_COLORS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <small>paypal.style.color</small>
        </Field>
        <Field label="Button shape" htmlFor="paypal-shape">
          <select
            id="paypal-shape"
            value={walletOptions.paypalShape}
            onChange={(event) =>
              updateWallet("paypalShape", event.currentTarget.value as PayPalShape)}
          >
            <option value="">Adyen default (rect)</option>
            {PAYPAL_SHAPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <small>paypal.style.shape</small>
        </Field>
        <Field label="Button label" htmlFor="paypal-label">
          <select
            id="paypal-label"
            value={walletOptions.paypalLabel}
            onChange={(event) =>
              updateWallet("paypalLabel", event.currentTarget.value as PayPalLabel)}
          >
            <option value="">Adyen default (paypal)</option>
            {PAYPAL_LABELS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <small>paypal.style.label</small>
        </Field>
        <SwitchRow
          label="Hide Pay Later button"
          hint={"blockPayPalPayLaterButton, PayPal adds a second, instalments " +
            "button when the amount and market qualify."}
          checked={walletOptions.paypalBlockPayLater}
          onChange={(value) => updateWallet("paypalBlockPayLater", value)}
        />
      </OptionGroup>
      <OptionGroup
        title="Placeholders"
        hint={PLACEHOLDERS_HINT}
        count={Object.values(cardOptions.placeholders).filter(Boolean).length}
        open={groupOpen("config:Placeholders")}
        onToggle={(open) => setGroupOpen("config:Placeholders", open)}
      >
        {PLACEHOLDER_FIELDS.map(([key, label, example]) => (
          <OptionRow
            key={key}
            id={`placeholder-${key}`}
            label={label}
            spec={{ kind: "text", fallback: example }}
            value={cardOptions.placeholders[key] ?? ""}
            onChange={(value) => updatePlaceholder(key, value)}
          />
        ))}
      </OptionGroup>
      <OptionGroup
        title="Billing address"
        hint="Collected inside the card form and sent with the payment."
        open={groupOpen("config:Billing address")}
        onToggle={(open) => setGroupOpen("config:Billing address", open)}
      >
        <SwitchRow
          label="Billing address required"
          hint="billingAddressRequired"
          checked={cardOptions.billingAddressRequired}
          onChange={(value) => updateCard("billingAddressRequired", value)}
        />
        {cardOptions.billingAddressRequired
          ? (
            <>
              <Field label="Address mode" htmlFor="card-billing-mode">
                <select
                  id="card-billing-mode"
                  value={cardOptions.billingAddressMode}
                  onChange={(event) =>
                    updateCard(
                      "billingAddressMode",
                      event.currentTarget.value as BillingAddressMode,
                    )}
                >
                  <option value="full">full, every field</option>
                  <option value="partial">partial, postal code only</option>
                  <option value="none">none, no fields</option>
                </select>
                <small>billingAddressMode</small>
              </Field>
              <div class="field">
                <label for="card-billing-required">Required fields</label>
                <CheckboxDropdown
                  id="card-billing-required"
                  items={ADDRESS_FIELDS}
                  selected={cardOptions.billingAddressRequiredFields}
                  emptyLabel="(empty) no required fields"
                  onChange={(next) => updateCard("billingAddressRequiredFields", next)}
                />
                <small>
                  billingAddressRequiredFields, empty means Adyen applies its own per-country
                  schema.
                </small>
              </div>
              <div class="field">
                <label for="card-billing-countries">Allowed countries</label>
                <CheckboxDropdown
                  id="card-billing-countries"
                  items={COUNTRY_ITEMS}
                  selected={cardOptions.billingAddressAllowedCountries}
                  emptyLabel="(empty) all countries"
                  onChange={(next) => updateCard("billingAddressAllowedCountries", next)}
                />
                <small>
                  billingAddressAllowedCountries, empty means every country Adyen supports.
                </small>
              </div>
            </>
          )
          : null}
      </OptionGroup>
      <OptionGroup
        title="Input behaviour"
        hint="Focus, formatting and validation of the secured fields."
        open={groupOpen("config:Input behaviour")}
        onToggle={(open) => setGroupOpen("config:Input behaviour", open)}
      >
        <SwitchRow
          label="Auto-focus next field"
          hint="autoFocus"
          checked={cardOptions.autoFocus}
          onChange={(value) => updateCard("autoFocus", value)}
        />
        <SwitchRow
          label="iOS keypad fix"
          hint={"keypadFix, works around an iOS/Safari bug where the keypad " +
            "stays up after the card field is no longer active."}
          checked={cardOptions.keypadFix}
          onChange={(value) => updateCard("keypadFix", value)}
        />
        <SwitchRow
          label="Legacy input mode"
          hint={"legacyInputMode, gives the fields type=tel instead of " +
            'type=text inputmode="numeric", for keyboards that ignore inputmode.'}
          checked={cardOptions.legacyInputMode}
          onChange={(value) => updateCard("legacyInputMode", value)}
        />
        <SwitchRow
          label="Disable iOS arrow keys"
          hint={"disableIOSArrowKeys, hides the ‹ › keys above the iOS keyboard, " +
            "which otherwise jump focus out of the secured field."}
          checked={cardOptions.disableIOSArrowKeys}
          onChange={(value) => updateCard("disableIOSArrowKeys", value)}
        />
        <SwitchRow
          label="Expose expiry date"
          hint={"exposeExpiryDate, the secured field also returns the expiry " +
            "unencrypted. Only the expiry, never the PAN, so it stays out of " +
            "PCI scope, but it does leave the iframe in clear."}
          checked={cardOptions.exposeExpiryDate}
          onChange={(value) => updateCard("exposeExpiryDate", value)}
        />
        <Field label="Minimum expiry date" htmlFor="card-min-expiry">
          <input
            id="card-min-expiry"
            type="text"
            value={cardOptions.minimumExpiryDate}
            placeholder="mm/yy"
            onInput={(event) => updateCard("minimumExpiryDate", event.currentTarget.value)}
          />
          {cardOptions.minimumExpiryDate &&
              !isValidExpiryDate(cardOptions.minimumExpiryDate)
            ? <small class="field-warning">Use the mm/yy format.</small>
            : <small>minimumExpiryDate, rejects cards expiring before this.</small>}
        </Field>
      </OptionGroup>
      {socialSecurityMarket || installmentMarket
        ? (
          <OptionGroup
            title="This market only"
            hint={`Options Adyen only applies in ${country}.`}
            open={groupOpen("config:Market")}
            onToggle={(open) => setGroupOpen("config:Market", open)}
          >
            {socialSecurityMarket
              ? (
                <Field label="Social security number" htmlFor="card-ssn-mode">
                  <select
                    id="card-ssn-mode"
                    value={cardOptions.socialSecurityNumberMode}
                    onChange={(event) =>
                      updateCard(
                        "socialSecurityNumberMode",
                        event.currentTarget.value as SocialSecurityNumberMode,
                      )}
                  >
                    <option value="auto">Auto (by card BIN)</option>
                    <option value="show">Always show</option>
                    <option value="hide">Never show</option>
                  </select>
                  <small>configuration.socialSecurityNumberMode, Brazil only.</small>
                </Field>
              )
              : null}
            {installmentMarket
              ? (
                <>
                  <p class="option-note">
                    installmentOptions is automatically sent in the /sessions request for this
                    market (Brazil, Mexico, Japan), no toggle needed. This only controls whether the
                    per-installment amount is displayed.
                  </p>
                  <SwitchRow
                    label="Show installment amounts"
                    hint="showInstallmentAmounts"
                    checked={cardOptions.showInstallmentAmounts}
                    onChange={(value) => updateCard("showInstallmentAmounts", value)}
                  />
                </>
              )
              : null}
          </OptionGroup>
        )
        : null}
      <OptionGroup
        title="Disclaimer message"
        hint="disclaimerMessage, rendered under the card fields."
        open={groupOpen("config:Disclaimer")}
        onToggle={(open) => setGroupOpen("config:Disclaimer", open)}
      >
        <SwitchRow
          label="Enable disclaimer"
          checked={cardOptions.disclaimerEnabled}
          onChange={(value) => updateCard("disclaimerEnabled", value)}
        />
        {cardOptions.disclaimerEnabled
          ? (
            <>
              <p class="option-note">
                A valid http(s):// Link URL is required to render the message, add one below even if
                you don't need clickable link text.
              </p>
              <Field label="Message" htmlFor="disclaimer-message">
                <input
                  id="disclaimer-message"
                  type="text"
                  value={cardOptions.disclaimerMessage}
                  placeholder="By continuing you agree to %{linkText}"
                  onInput={(event) => updateCard("disclaimerMessage", event.currentTarget.value)}
                />
                <small>{"Use %{linkText} to reference the link text below."}</small>
              </Field>
              <Field label="Link text" htmlFor="disclaimer-link-text">
                <input
                  id="disclaimer-link-text"
                  type="text"
                  value={cardOptions.disclaimerLinkText}
                  onInput={(event) => updateCard("disclaimerLinkText", event.currentTarget.value)}
                />
              </Field>
              <Field label="Link URL" htmlFor="disclaimer-link">
                <input
                  id="disclaimer-link"
                  type="url"
                  value={cardOptions.disclaimerLink}
                  placeholder="https://example.com/terms"
                  onInput={(event) => updateCard("disclaimerLink", event.currentTarget.value)}
                />
                {cardOptions.disclaimerMessage &&
                    !isValidHttpUrl(cardOptions.disclaimerLink)
                  ? (
                    <small class="field-warning">
                      Add a valid http(s):// URL above to display the message.
                    </small>
                  )
                  : null}
              </Field>
            </>
          )
          : null}
      </OptionGroup>
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

/** The design tokens, the class-name rules and the generated stylesheet. */
export function ThemePanel(props: {
  cssTokens: CssTokens;
  cssRules: CssRules;
  tokenOverrides: number;
  generatedCss: string;
  updateToken: (token: string, value: string) => void;
  updateRule: <K extends keyof CssRules>(key: K, value: CssRules[K]) => void;
  setCssTokens: (tokens: CssTokens) => void;
  setCssRules: (rules: CssRules) => void;
  groupOpen: (key: string) => boolean;
  setGroupOpen: (key: string, open: boolean) => void;
}) {
  const {
    cssTokens,
    cssRules,
    tokenOverrides,
    generatedCss,
    updateToken,
    updateRule,
    setCssTokens,
    setCssRules,
    groupOpen,
    setGroupOpen,
  } = props;
  return (
    <>
      <p class="css-note">
        The {CSS_TOKEN_SPECS.length}{" "}
        custom properties below are the ones Adyen Web actually reads, taken from the stylesheet it
        ships. They are the supported way to theme the Drop-in; the class-name rules at the end are
        not, and can break on any upgrade.
      </p>
      <p class="css-cdn-link">
        Base stylesheet:{" "}
        <a href={ADYEN_CSS_URL} target="_blank" rel="noopener noreferrer">
          adyen.css ({ADYEN_WEB_VERSION})
        </a>
      </p>
      <div class="styling-filter-row">
        {tokenOverrides
          ? (
            <button
              type="button"
              class="button button--quiet button--small"
              onClick={() => setCssTokens({})}
            >
              Clear {tokenOverrides}
            </button>
          )
          : null}
      </div>
      {CSS_TOKEN_GROUPS.map((group) => {
        const specs = CSS_TOKEN_SPECS.filter((spec) => spec.group === group);
        if (specs.length === 0) return null;
        const key = `css:${group}`;
        return (
          <OptionGroup
            key={key}
            title={group}
            count={cssTokenSetCount(cssTokens, group)}
            open={groupOpen(key)}
            onToggle={(open) => setGroupOpen(key, open)}
          >
            {specs.map((spec) => (
              <OptionRow
                key={spec.token}
                id={`token-${spec.token}`}
                label={spec.label}
                hint={`--adyen-sdk-${spec.token}`}
                spec={spec}
                value={cssTokens[spec.token] ?? ""}
                onChange={(value) => updateToken(spec.token, value)}
              />
            ))}
          </OptionGroup>
        );
      })}
      <OptionGroup
        title="Class-name rules"
        hint={RULES_HINT}
        hintTone="danger"
        count={cssRuleSetCount(cssRules)}
        open={groupOpen("css:Rules")}
        onToggle={(open) => setGroupOpen("css:Rules", open)}
      >
        {CSS_RULE_SPECS.map(({ key, label, spec, hint }) => (
          <OptionRow
            key={key}
            id={`rule-${key}`}
            label={label}
            hint={hint}
            spec={spec}
            value={cssRules[key]}
            onChange={(value) => updateRule(key, value)}
          />
        ))}
        <SwitchRow
          label="Uppercase pay button"
          checked={cssRules.uppercaseButton}
          onChange={(value) => updateRule("uppercaseButton", value)}
        />
        <SwitchRow
          label="Compact method headers"
          checked={cssRules.compactMethods}
          onChange={(value) => updateRule("compactMethods", value)}
        />
        {
          /* A slider commits as soon as it is touched, and these
                        now persist, so brushing one leaves a rule we advise
                        against in the stylesheet until it is cleared. One
                        click drops all of them. */
        }
        {cssRuleSetCount(cssRules) > 0
          ? (
            <div class="option-group__actions">
              <button
                type="button"
                class="button button--quiet button--small"
                onClick={() => setCssRules(DEFAULT_CSS_RULES)}
              >
                Remove all class-name rules
              </button>
            </div>
          )
          : null}
      </OptionGroup>
      <RawOutput
        content={generatedCss}
        filename="adyen-overrides.css"
        mime="text/css"
      />
    </>
  );
}

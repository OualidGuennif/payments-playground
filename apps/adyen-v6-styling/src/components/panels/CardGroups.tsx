// Spec: knowledge/components/adyen-v6-styling.md
import { Field } from "@suite/ui/components.tsx";
import {
  INSTALLMENT_COUNTRIES,
  SOCIAL_SECURITY_NUMBER_COUNTRIES,
} from "@suite/ui/paymentMethods.ts";
import { CheckboxDropdown, OptionGroup, OptionRow, SwitchRow } from "../OptionFields.tsx";
import {
  ADDRESS_FIELDS,
  isValidExpiryDate,
  isValidHttpUrl,
  PLACEHOLDER_FIELDS,
} from "../../options/card.ts";
import type { BillingAddressMode, SocialSecurityNumberMode } from "../../options/card.ts";
import { COUNTRY_ITEMS, PLACEHOLDERS_HINT } from "../styling-data.ts";
import type { ComponentsPanelProps } from "./ComponentsPanel.tsx";

/** Which card fields the form shows. */
export function CardFieldsGroup(
  props: Pick<ComponentsPanelProps, "cardOptions" | "updateCard" | "groupOpen" | "setGroupOpen">,
) {
  const { cardOptions, updateCard, groupOpen, setGroupOpen } = props;
  return (
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
          onChange={(event) => updateCard("holderNamePrefill", event.currentTarget.value)}
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
  );
}

/** Placeholders, billing address, input behaviour, market-only fields and the disclaimer. */
export function CardFormGroups(
  props: Pick<
    ComponentsPanelProps,
    "cardOptions" | "country" | "updateCard" | "updatePlaceholder" | "groupOpen" | "setGroupOpen"
  >,
) {
  const { cardOptions, country, updateCard, updatePlaceholder, groupOpen, setGroupOpen } = props;
  const installmentMarket = INSTALLMENT_COUNTRIES.includes(country);
  const socialSecurityMarket = SOCIAL_SECURITY_NUMBER_COUNTRIES.includes(country);
  return (
    <>
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
        {cardOptions.billingAddressRequired ? (
          <>
            <Field label="Address mode" htmlFor="card-billing-mode">
              <select
                id="card-billing-mode"
                value={cardOptions.billingAddressMode}
                onChange={(event) =>
                  updateCard("billingAddressMode", event.currentTarget.value as BillingAddressMode)
                }
              >
                <option value="full">full, every field</option>
                <option value="partial">partial, postal code only</option>
                <option value="none">none, no fields</option>
              </select>
              <small>billingAddressMode</small>
            </Field>
            <div className="field">
              <label htmlFor="card-billing-required">Required fields</label>
              <CheckboxDropdown
                id="card-billing-required"
                items={ADDRESS_FIELDS}
                selected={cardOptions.billingAddressRequiredFields}
                emptyLabel="(empty) no required fields"
                onChange={(next) => updateCard("billingAddressRequiredFields", next)}
              />
              <small>
                billingAddressRequiredFields, empty means Adyen applies its own per-country schema.
              </small>
            </div>
            <div className="field">
              <label htmlFor="card-billing-countries">Allowed countries</label>
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
        ) : null}
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
          hint={
            "keypadFix, works around an iOS/Safari bug where the keypad " +
            "stays up after the card field is no longer active."
          }
          checked={cardOptions.keypadFix}
          onChange={(value) => updateCard("keypadFix", value)}
        />
        <SwitchRow
          label="Legacy input mode"
          hint={
            "legacyInputMode, gives the fields type=tel instead of " +
            'type=text inputMode="numeric", for keyboards that ignore inputmode.'
          }
          checked={cardOptions.legacyInputMode}
          onChange={(value) => updateCard("legacyInputMode", value)}
        />
        <SwitchRow
          label="Disable iOS arrow keys"
          hint={
            "disableIOSArrowKeys, hides the ‹ › keys above the iOS keyboard, " +
            "which otherwise jump focus out of the secured field."
          }
          checked={cardOptions.disableIOSArrowKeys}
          onChange={(value) => updateCard("disableIOSArrowKeys", value)}
        />
        <SwitchRow
          label="Expose expiry date"
          hint={
            "exposeExpiryDate, the secured field also returns the expiry " +
            "unencrypted. Only the expiry, never the PAN, so it stays out of " +
            "PCI scope, but it does leave the iframe in clear."
          }
          checked={cardOptions.exposeExpiryDate}
          onChange={(value) => updateCard("exposeExpiryDate", value)}
        />
        <Field label="Minimum expiry date" htmlFor="card-min-expiry">
          <input
            id="card-min-expiry"
            type="text"
            value={cardOptions.minimumExpiryDate}
            placeholder="mm/yy"
            onChange={(event) => updateCard("minimumExpiryDate", event.currentTarget.value)}
          />
          {cardOptions.minimumExpiryDate && !isValidExpiryDate(cardOptions.minimumExpiryDate) ? (
            <small className="field-warning">Use the mm/yy format.</small>
          ) : (
            <small>minimumExpiryDate, rejects cards expiring before this.</small>
          )}
        </Field>
      </OptionGroup>
      {socialSecurityMarket || installmentMarket ? (
        <OptionGroup
          title="This market only"
          hint={`Options Adyen only applies in ${country}.`}
          open={groupOpen("config:Market")}
          onToggle={(open) => setGroupOpen("config:Market", open)}
        >
          {socialSecurityMarket ? (
            <Field label="Social security number" htmlFor="card-ssn-mode">
              <select
                id="card-ssn-mode"
                value={cardOptions.socialSecurityNumberMode}
                onChange={(event) =>
                  updateCard(
                    "socialSecurityNumberMode",
                    event.currentTarget.value as SocialSecurityNumberMode,
                  )
                }
              >
                <option value="auto">Auto (by card BIN)</option>
                <option value="show">Always show</option>
                <option value="hide">Never show</option>
              </select>
              <small>configuration.socialSecurityNumberMode, Brazil only.</small>
            </Field>
          ) : null}
          {installmentMarket ? (
            <>
              <p className="option-note">
                installmentOptions is automatically sent in the /sessions request for this market
                (Brazil, Mexico, Japan), no toggle needed. This only controls whether the
                per-installment amount is displayed.
              </p>
              <SwitchRow
                label="Show installment amounts"
                hint="showInstallmentAmounts"
                checked={cardOptions.showInstallmentAmounts}
                onChange={(value) => updateCard("showInstallmentAmounts", value)}
              />
            </>
          ) : null}
        </OptionGroup>
      ) : null}
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
        {cardOptions.disclaimerEnabled ? (
          <>
            <p className="option-note">
              A valid http(s):// Link URL is required to render the message, add one below even if
              you don't need clickable link text.
            </p>
            <Field label="Message" htmlFor="disclaimer-message">
              <input
                id="disclaimer-message"
                type="text"
                value={cardOptions.disclaimerMessage}
                placeholder="By continuing you agree to %{linkText}"
                onChange={(event) => updateCard("disclaimerMessage", event.currentTarget.value)}
              />
              <small>{"Use %{linkText} to reference the link text below."}</small>
            </Field>
            <Field label="Link text" htmlFor="disclaimer-link-text">
              <input
                id="disclaimer-link-text"
                type="text"
                value={cardOptions.disclaimerLinkText}
                onChange={(event) => updateCard("disclaimerLinkText", event.currentTarget.value)}
              />
            </Field>
            <Field label="Link URL" htmlFor="disclaimer-link">
              <input
                id="disclaimer-link"
                type="url"
                value={cardOptions.disclaimerLink}
                placeholder="https://example.com/terms"
                onChange={(event) => updateCard("disclaimerLink", event.currentTarget.value)}
              />
              {cardOptions.disclaimerMessage && !isValidHttpUrl(cardOptions.disclaimerLink) ? (
                <small className="field-warning">
                  Add a valid http(s):// URL above to display the message.
                </small>
              ) : null}
            </Field>
          </>
        ) : null}
      </OptionGroup>
    </>
  );
}

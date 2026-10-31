// Spec: knowledge/components/adyen-digital.md
import { Field } from "@suite/ui/components.tsx";
import {
  CURRENCY_OPTIONS,
  flagEmoji,
  LOCALE_OPTIONS,
  MARKETS,
  type PublicProfile,
} from "./flow-helpers.ts";
import { Sheet } from "./Sheet.tsx";

/** The settings sheet: market, integration, 3DS and server profile. */
export function FlowSettings(props: {
  open: boolean;
  onClose: () => void;
  country: string;
  locale: string;
  currency: string;
  amount: number;
  amountDraft: string | null;
  exponent: number;
  integration: "dropin" | "component";
  hasIntegration: boolean;
  hasThreeDSChoice: boolean;
  nativeThreeDS: boolean;
  profileId: string;
  profiles: PublicProfile[];
  onMarket: (country: string) => void;
  onLocale: (locale: string) => void;
  onCurrency: (currency: string) => void;
  onAmount: (text: string) => void;
  onAmountBlur: () => void;
  onIntegration: (integration: "dropin" | "component") => void;
  onNativeThreeDS: (nativeThreeDS: boolean) => void;
  onProfile: (profileId: string) => void;
}) {
  const {
    amount,
    amountDraft,
    country,
    currency,
    exponent,
    hasIntegration,
    hasThreeDSChoice,
    integration,
    locale,
    nativeThreeDS,
    profileId,
    profiles,
  } = props;
  return (
    <Sheet
      open={props.open}
      title="Checkout settings"
      subtitle="Changes reload the checkout."
      onClose={props.onClose}
      footer={
        <button
          class="button button--primary button--block"
          type="button"
          onClick={props.onClose}
        >
          Done
        </button>
      }
    >
      <section class="config-group">
        <h3>Market</h3>
        <Field label="Country" htmlFor="config-country">
          <select
            id="config-country"
            value={country}
            onChange={(event) => props.onMarket(event.currentTarget.value)}
          >
            {MARKETS.map(([code, name]) => (
              <option key={code} value={code}>{flagEmoji(code)} {name}</option>
            ))}
          </select>
        </Field>
        <div class="config-row">
          <Field label="Language" htmlFor="config-locale">
            <select
              id="config-locale"
              value={locale}
              onChange={(event) => props.onLocale(event.currentTarget.value)}
            >
              {LOCALE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Currency" htmlFor="config-currency">
            <select
              id="config-currency"
              value={currency}
              onChange={(event) => props.onCurrency(event.currentTarget.value)}
            >
              {CURRENCY_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
        </div>
        <Field
          label="Amount"
          htmlFor="config-amount"
          hint={`Sent to Adyen as ${amount} minor units`}
        >
          <input
            id="config-amount"
            inputMode="decimal"
            value={amountDraft ?? (amount / 10 ** exponent).toFixed(exponent)}
            onInput={(event) => props.onAmount(event.currentTarget.value)}
            onBlur={props.onAmountBlur}
          />
        </Field>
      </section>
      {hasIntegration
        ? (
          <section class="config-group">
            <h3>Integration</h3>
            <div class="segmented-control" role="group" aria-label="Frontend integration">
              <button
                type="button"
                aria-pressed={integration === "dropin"}
                onClick={() => props.onIntegration("dropin")}
              >
                Drop-in
              </button>
              <button
                type="button"
                aria-pressed={integration === "component"}
                onClick={() => props.onIntegration("component")}
              >
                Components
              </button>
            </div>
            <p class="config-hint">
              {integration === "dropin"
                ? "Every payment method in one list."
                : "One payment method at a time; pick it above the payment form."}
            </p>
          </section>
        )
        : null}
      {hasThreeDSChoice
        ? (
          <section class="config-group">
            <h3>3D Secure</h3>
            <label class="switch-row">
              <span>
                <strong>Native 3DS</strong>
                <small>
                  {nativeThreeDS
                    ? "The challenge opens inside the checkout (nativeThreeDS: preferred)."
                    : "The shopper is redirected to the issuer's page (nativeThreeDS: disabled)."}
                </small>
              </span>
              <input
                type="checkbox"
                checked={nativeThreeDS}
                onChange={(event) => props.onNativeThreeDS(event.currentTarget.checked)}
              />
            </label>
          </section>
        )
        : null}
      <section class="config-group">
        <h3>Server profile</h3>
        <Field label="TEST credentials" htmlFor="config-profile">
          <select
            id="config-profile"
            value={profileId}
            onChange={(event) => props.onProfile(event.currentTarget.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
                {profile.isConfigured ? "" : " (incomplete)"}
              </option>
            ))}
          </select>
        </Field>
        <p class="config-hint">
          Add or remove profiles in <a href="/settings">Settings</a>.
        </p>
      </section>
    </Sheet>
  );
}

// Spec: knowledge/components/adyen-v6-styling.md
// A tab of the styling panel. It owns no state: the island stays the single source of
// truth, so switching tabs keeps what you have set.
import { OptionGroup, OptionRow } from "../OptionFields.tsx";
import {
  cardConfigObject,
  securedFieldMethodConfigObjects,
  storedCardConfigObject,
} from "../../options/card.ts";
import {
  SECURE_GROUPS,
  SECURE_PROPERTY_SPECS,
  SECURE_STATE_META,
  SECURE_STATES,
  secureSetCount,
} from "../../options/secured-fields.ts";
import type { CardOptions } from "../../options/card.ts";
import type { SecureProperty, SecureState, SecureStyles } from "../../options/secured-fields.ts";
import { RawOutput } from "./RawOutput.tsx";

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
      <p className="css-note">
        The card number, expiry date and security code are rendered inside Adyen-hosted iframes, so
        no page CSS can reach them: they are styled only through this object. All{" "}
        {SECURE_PROPERTY_SPECS.length} properties Adyen accepts are below, for each of its four
        states.
      </p>
      <div className="styling-segmented" role="tablist" aria-label="Field state">
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
              {count ? <span className="styling-segmented__count">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <p className="option-group__hint">{SECURE_STATE_META[secureState].hint}</p>
      {SECURE_GROUPS.map((group) => {
        const specs = SECURE_PROPERTY_SPECS.filter((spec) => spec.group === group);
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

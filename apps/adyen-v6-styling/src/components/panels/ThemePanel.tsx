// Spec: knowledge/components/adyen-v6-styling.md
// A tab of the styling panel. It owns no state: the island stays the single source of
// truth, so switching tabs keeps what you have set.
import { OptionGroup, OptionRow, SwitchRow } from "../OptionFields.tsx";
import { ADYEN_CSS_URL, ADYEN_WEB_VERSION } from "../../options/controls.ts";
import {
  CSS_RULE_SPECS,
  CSS_TOKEN_GROUPS,
  CSS_TOKEN_SPECS,
  cssRuleSetCount,
  cssTokenSetCount,
  DEFAULT_CSS_RULES,
} from "../../options/css-tokens.ts";
import type { CssRules, CssTokens } from "../../options/css-tokens.ts";
import { RULES_HINT } from "../styling-data.ts";
import { RawOutput } from "./RawOutput.tsx";

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
      <p className="css-note">
        The {CSS_TOKEN_SPECS.length} custom properties below are the ones Adyen Web actually reads,
        taken from the stylesheet it ships. They are the supported way to theme the Drop-in; the
        class-name rules at the end are not, and can break on any upgrade.
      </p>
      <p className="css-cdn-link">
        Base stylesheet:{" "}
        <a href={ADYEN_CSS_URL} target="_blank" rel="noopener noreferrer">
          adyen.css ({ADYEN_WEB_VERSION})
        </a>
      </p>
      <div className="styling-filter-row">
        {tokenOverrides ? (
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => setCssTokens({})}
          >
            Clear {tokenOverrides}
          </button>
        ) : null}
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
        {/* A slider commits as soon as it is touched, and these
                        now persist, so brushing one leaves a rule we advise
                        against in the stylesheet until it is cleared. One
                        click drops all of them. */}
        {cssRuleSetCount(cssRules) > 0 ? (
          <div className="option-group__actions">
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => setCssRules(DEFAULT_CSS_RULES)}
            >
              Remove all class-name rules
            </button>
          </div>
        ) : null}
      </OptionGroup>
      <RawOutput content={generatedCss} filename="adyen-overrides.css" mime="text/css" />
    </>
  );
}

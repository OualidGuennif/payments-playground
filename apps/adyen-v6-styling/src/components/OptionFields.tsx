import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ControlSpec } from "./adyenOptions.ts";

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Collapsible section. Open state is owned by the panel so that filtering can
 * force every matching group open without fighting the native <details>.
 */
export function OptionGroup(props: {
  title: string;
  hint?: string;
  /** Renders the hint as a warning, for options that are not safe defaults. */
  hintTone?: "danger";
  count?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="option-group"
      // Lets a closed panel show which sections you have actually touched. The
      // count badge alone only says so once you have found the right row.
      data-changed={props.count ? "true" : "false"}
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
    >
      <summary className="option-group__summary">
        <span className="option-group__title">{props.title}</span>
        {props.count ? <span className="option-group__count">{props.count} set</span> : null}
      </summary>
      {props.hint
        ? (
          <p
            className={`option-group__hint${
              props.hintTone === "danger" ? " option-group__hint--danger" : ""
            }`}
          >
            {props.hint}
          </p>
        )
        : null}
      <div className="option-group__body">{props.children}</div>
    </details>
  );
}

export function SwitchRow(props: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <span>
        {props.label}
        {props.hint ? <small>{props.hint}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

/**
 * A checkbox list folded behind a summary, for options whose full set is long
 * enough that a flat cloud of chips swamps the panel. "(empty)" is a real
 * entry rather than a hint, since leaving the list empty is the meaningful
 * default: Adyen then applies its own per-country schema.
 *
 * The list expands in the flow rather than floating over it. An absolutely
 * positioned menu gets clipped by the group's own `overflow: hidden` (there
 * for the rounded corners) and disappears under the next section; in-flow it
 * simply pushes the panel down and scrolls with everything else.
 */
export function CheckboxDropdown(props: {
  id: string;
  items: [string, string][];
  selected: string[];
  emptyLabel: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Names, not the underlying values: the button reads "France", not "FR",
  // matching the row the reader ticked.
  const label = (value: string) => props.items.find(([key]) => key === value)?.[1] ?? value;
  const summary = props.selected.length === 0
    ? props.emptyLabel
    : props.selected.length <= 3
    ? props.selected.map(label).join(", ")
    : `${props.selected.length} selected`;

  return (
    <div className="checkbox-dropdown" data-open={open ? "true" : "false"}>
      <button
        type="button"
        id={props.id}
        className="checkbox-dropdown__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="checkbox-dropdown__value">{summary}</span>
        <span className="checkbox-dropdown__chevron" aria-hidden="true">▾</span>
      </button>
      {open
        ? (
          <div className="checkbox-dropdown__list" role="group">
            <label className="checkbox-dropdown__item">
              <input
                type="checkbox"
                checked={props.selected.length === 0}
                onChange={() => props.onChange([])}
              />
              {props.emptyLabel}
            </label>
            {props.items.map(([value, label]) => {
              const on = props.selected.includes(value);
              return (
                <label key={value} className="checkbox-dropdown__item">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) =>
                      props.onChange(
                        event.currentTarget.checked
                          ? [...props.selected, value]
                          : props.selected.filter((entry) => entry !== value),
                      )}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        )
        : null}
    </div>
  );
}

// A half-typed hex ("#00") would blank the swatch, so the text half only
// pushes upstream once the value can actually be rendered, while still
// accepting the function notations and keywords a hex picker cannot express.
function isCommittableColor(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith("#")) return HEX_PATTERN.test(value);
  return value.trim().length > 2;
}

function ColorControl(
  props: { id: string; value: string; fallback: string; onChange: (value: string) => void },
) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <div className="color-field">
      <input
        id={props.id}
        type="color"
        value={props.value || props.fallback}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          props.onChange(next);
        }}
      />
      <input
        type="text"
        className="color-field__hex"
        value={text}
        placeholder={props.fallback}
        spellCheck={false}
        aria-label="Value"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          if (isCommittableColor(next)) props.onChange(next);
        }}
      />
    </div>
  );
}

/**
 * One option, whatever its type. An empty value always means "not set", which
 * is what keeps the generated config and CSS down to what was actually
 * changed instead of a dump of every property.
 */
export function OptionRow(props: {
  id: string;
  label: string;
  hint?: string;
  spec: ControlSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  const { spec } = props;
  const fallback = spec.fallback ?? "";
  return (
    <div className={`field option-row${props.value ? " option-row--set" : ""}`}>
      <div className="option-row__head">
        <label htmlFor={props.id}>{props.label}</label>
        {props.value
          ? (
            <button
              type="button"
              className="option-row__clear"
              title="Back to the Adyen default"
              aria-label={`Reset ${props.label}`}
              onClick={() => props.onChange("")}
            >
              ↺
            </button>
          )
          : null}
      </div>
      {spec.kind === "color"
        ? (
          <ColorControl
            id={props.id}
            value={props.value}
            fallback={fallback}
            onChange={props.onChange}
          />
        )
        : spec.kind === "select"
        ? (
          <select
            id={props.id}
            value={props.value}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          >
            <option value="">
              {fallback ? `Adyen default (${fallback})` : "Adyen default"}
            </option>
            {(spec.options ?? []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        )
        : spec.kind === "range"
        ? (
          <div className="range-field">
            <input
              id={props.id}
              type="range"
              min={spec.min ?? 0}
              max={spec.max ?? 64}
              step={spec.step ?? 1}
              value={Number.parseFloat(props.value || fallback) || 0}
              onChange={(event) =>
                props.onChange(`${event.currentTarget.valueAsNumber}${spec.unit ?? ""}`)}
            />
            <small>{props.value || `${fallback} (default)`}</small>
          </div>
        )
        : (
          <input
            id={props.id}
            type="text"
            value={props.value}
            placeholder={fallback}
            spellCheck={false}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          />
        )}
      {props.hint ? <small>{props.hint}</small> : null}
    </div>
  );
}

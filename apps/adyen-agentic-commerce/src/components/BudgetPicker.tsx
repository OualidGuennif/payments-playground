// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useState } from "react";

const PRESETS = [50, 150, 300, 1000];

// The consent page's budget: presets for the usual amounts and the field itself, which posts alone
// when the page runs without JavaScript.
export function BudgetPicker({ initial = 150 }: { initial?: number }) {
  const [value, setValue] = useState(String(initial));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Budget for this agent</legend>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((amount) => {
          const on = Number(value) === amount;
          return (
            <button
              key={amount}
              type="button"
              aria-pressed={on}
              onClick={() => setValue(String(amount))}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium tabular-nums ${
                on ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink"
              }`}
            >
              €{amount}
            </button>
          );
        })}
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">or €</span>
          <input
            type="number"
            name="spend_limit_eur"
            min={0}
            max={1000}
            step={10}
            inputMode="numeric"
            aria-label="Budget in euros"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="field w-24 tabular-nums"
          />
        </label>
      </div>
      <p className="text-xs text-muted">Anything above it, you approve and pay yourself.</p>
    </fieldset>
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useId } from "react";
import {
  type Delivery,
  deliveryFee,
  METHODS,
  placesFor,
  placeText,
  withMethod,
} from "@/lib/delivery";
import { money } from "@/lib/money";

// The checkout page's and the Ask panel's delivery choice: a method, then one of its places from
// the store's lists, preselected. It only reports a choice; the caller saves it and shows the total.
export function DeliveryPicker({
  value,
  subtotal,
  disabled,
  onChange,
}: {
  value: Delivery;
  subtotal: number;
  disabled?: boolean;
  onChange: (next: Delivery) => void;
}) {
  const id = useId();
  const pickup = value.method === "pickup";
  return (
    <fieldset className="min-w-0 space-y-2.5" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Delivery</legend>
      <div className="grid gap-2">
        {METHODS.map((method) => {
          const fee = deliveryFee(method.id, subtotal);
          const on = value.method === method.id;
          return (
            <label
              key={method.id}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                on ? "border-ink" : "border-line hover:border-ink"
              }`}
            >
              <input
                type="radio"
                name={`${id}-method`}
                value={method.id}
                checked={on}
                onChange={() => onChange(withMethod(value, method.id))}
                className="size-4 accent-ink"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{method.label}</span>
                <span className="block text-xs text-muted">{method.timing}</span>
              </span>
              <span className="tabular-nums">{fee ? money(fee) : "Free"}</span>
            </label>
          );
        })}
      </div>
      <label className="block space-y-1 text-sm" htmlFor={`${id}-place`}>
        <span className="text-muted">{pickup ? "Pickup point" : "Deliver to"}</span>
        <select
          id={`${id}-place`}
          className="field min-h-11"
          value={value.placeId}
          onChange={(event) => onChange({ method: value.method, placeId: event.target.value })}
        >
          {placesFor(value.method).map((place) => (
            <option key={place.id} value={place.id}>
              {placeText(place)}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

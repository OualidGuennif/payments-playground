// Spec: knowledge/components/adyen-digital.md
import { Field } from "@suite/ui/components.tsx";
import type { RecurringModel, StoredMethod } from "../../checkout/flow-helpers.ts";

/** Picks a card Adyen stored for this week's shopper and the recurring model to charge it with. */
export function MitPanel(props: {
  storedMethods: StoredMethod[] | null;
  storedPaymentMethodId: string;
  onStoredPaymentMethodId(id: string): void;
  recurringModel: RecurringModel;
  onRecurringModel(model: RecurringModel): void;
  shopperReference: string;
  onShopperReference(reference: string): void;
  amountText: string;
  loading: boolean;
  canCharge: boolean;
  onCharge(): void;
}) {
  const { storedMethods, storedPaymentMethodId, recurringModel } = props;
  const selected = storedMethods?.find((method) => method.id === storedPaymentMethodId);
  const modelMismatch =
    selected?.supportedRecurringProcessingModels?.length &&
    !selected.supportedRecurringProcessingModels.includes(recurringModel);
  return (
    <form
      className="pay-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onCharge();
      }}
    >
      <fieldset className="choice-list">
        <legend>Saved payment method</legend>
        {storedMethods === null ? (
          <p className="muted">Looking up this week's saved cards…</p>
        ) : storedMethods.length ? (
          storedMethods.map((method) => (
            <label className="choice" key={method.id}>
              <input
                type="radio"
                name="stored"
                checked={storedPaymentMethodId === method.id}
                onChange={() => props.onStoredPaymentMethodId(method.id)}
              />
              <span className="choice__main">
                <strong>
                  {method.brand ?? method.name ?? "Card"}
                  {method.lastFour ? ` •••• ${method.lastFour}` : ""}
                </strong>
                <small>
                  {method.expiryMonth ? `Expires ${method.expiryMonth}/${method.expiryYear}` : ""}
                </small>
              </span>
            </label>
          ))
        ) : (
          <p className="muted">
            No saved card for this week's shopper yet. Pay once in{" "}
            <a href="/advanced?integration=dropin">Advanced</a> with “Save for my next payment”
            ticked, then come back.
          </p>
        )}
      </fieldset>
      <div className="field">
        <span>Recurring model</span>
        <div className="segmented-control">
          {(["UnscheduledCardOnFile", "Subscription"] as const).map((model) => (
            <button
              key={model}
              type="button"
              aria-pressed={recurringModel === model}
              onClick={() => props.onRecurringModel(model)}
            >
              {model === "UnscheduledCardOnFile" ? "Unscheduled" : "Subscription"}
            </button>
          ))}
        </div>
        {modelMismatch ? (
          <small className="field-warning">
            This card was saved for {selected?.supportedRecurringProcessingModels?.join(", ")};
            Adyen may refuse a {recurringModel} charge.
          </small>
        ) : null}
      </div>
      <details className="more">
        <summary>Use another token</summary>
        <Field label="storedPaymentMethodId" htmlFor="stored-id" hint="Adyen token, never a PAN">
          <input
            id="stored-id"
            autoComplete="off"
            value={storedPaymentMethodId}
            onChange={(event) => props.onStoredPaymentMethodId(event.currentTarget.value)}
          />
        </Field>
        <Field label="Shopper reference" htmlFor="shopper-ref" hint="Must not contain PII">
          <input
            id="shopper-ref"
            value={props.shopperReference}
            onChange={(event) => props.onShopperReference(event.currentTarget.value)}
          />
        </Field>
      </details>
      <button
        className="button button--primary button--block"
        type="submit"
        disabled={props.loading || !storedPaymentMethodId || !props.canCharge}
      >
        {props.loading ? "Charging…" : `Charge ${props.amountText}`}
      </button>
    </form>
  );
}

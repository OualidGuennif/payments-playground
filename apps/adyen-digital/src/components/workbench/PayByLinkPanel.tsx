// Spec: knowledge/components/adyen-digital.md
import { Field } from "@suite/ui/components.tsx";
import { useCopy } from "@suite/ui/useCopy.ts";
import { field } from "../../checkout/client.ts";
import { VALIDITY_OPTIONS } from "../../checkout/flow-helpers.ts";

/** The link form, then the link Adyen created with its status. */
export function PayByLinkPanel(props: {
  link: Record<string, unknown> | null;
  linkState: string | null;
  amountText: string;
  correlationId: string | null;
  validityHours: number;
  onValidityHours(hours: number): void;
  reusable: boolean;
  onReusable(reusable: boolean): void;
  loading: boolean;
  canCreate: boolean;
  onCreate(): void;
  onRefresh(): void;
  onAnother(): void;
}) {
  const { copied, copy } = useCopy();
  const { link } = props;
  if (link) {
    const url = field(link, "url") ?? "";
    const expiresAt = field(link, "expiresAt");
    return (
      <div className="link-card">
        <div className="link-card__head">
          <h3>Payment link ready</h3>
          <span className="status-pill status-pill--info">{props.linkState ?? "active"}</span>
        </div>
        <a className="link-card__url" href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
        <div className="link-card__actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => copy(url, { raw: true })}
          >
            {copied === url ? "Copied" : "Copy link"}
          </button>
          <a
            className="button button--secondary"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open ↗
          </a>
          <button
            className="button button--secondary"
            type="button"
            disabled={props.loading}
            onClick={props.onRefresh}
          >
            Refresh status
          </button>
        </div>
        <dl className="facts">
          <dt>Amount</dt>
          <dd>{props.amountText}</dd>
          {expiresAt ? (
            <>
              <dt>Expires</dt>
              <dd>{new Date(expiresAt).toLocaleString()}</dd>
            </>
          ) : null}
          <dt>Reusable</dt>
          <dd>{field(link, "reusable") ?? (props.reusable ? "yes" : "no")}</dd>
        </dl>
        <div className="result__actions">
          <button className="text-button" type="button" onClick={props.onAnother}>
            Create another link
          </button>
          {props.correlationId ? (
            <a className="text-button" href={`/back-office?orderId=${props.correlationId}`}>
              Open in Back Office
            </a>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <form
      className="pay-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onCreate();
      }}
    >
      <Field label="Link valid for" htmlFor="validity">
        <select
          id="validity"
          value={props.validityHours}
          onChange={(event) => props.onValidityHours(Number(event.currentTarget.value))}
        >
          {VALIDITY_OPTIONS.map(([hours, label]) => (
            <option key={hours} value={hours}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <label className="switch-row">
        <span>
          <strong>Reusable</strong>
          <small>Several shoppers can pay with the same link.</small>
        </span>
        <input
          type="checkbox"
          checked={props.reusable}
          onChange={(event) => props.onReusable(event.currentTarget.checked)}
        />
      </label>
      <button
        className="button button--primary button--block"
        type="submit"
        disabled={props.loading || !props.canCreate}
      >
        {props.loading ? "Creating…" : `Create a link for ${props.amountText}`}
      </button>
    </form>
  );
}

import {
  CAPABILITIES_REVIEWED_ON,
  CAPABILITIES_SOURCE,
  PAYMENT_METHOD_CAPABILITIES,
} from "@suite/platform/lifecycle.ts";
import { Callout, PageHeader } from "@suite/ui/components.tsx";
import { DigitalLayout } from "../components/Layout.tsx";
import { define } from "../utils.ts";

const sections = [
  ["sessions", "Sessions Flow"],
  ["advanced", "Advanced Flow"],
  ["callbacks", "Frontend callbacks"],
  ["webhooks", "Webhooks, HMAC & idempotency"],
  ["lifecycle", "Payment lifecycle"],
  ["partial", "Partial payments"],
  ["pbl", "Pay by Link"],
  ["mit", "MIT & tokenization"],
  ["pci", "API Only & PCI"],
  ["troubleshooting", "Troubleshooting"],
] as const;

export default define.page(function WikiPage() {
  return (
    <DigitalLayout path="/wiki">
      <PageHeader
        eyebrow="Living reference"
        title="Digital integration wiki"
        description="Maintained against Adyen Web 6.47.0 and Checkout API v72. The supplied callback PDF (v6.40.2) is used as a reviewed secondary source."
      />
      <Callout title="Source policy">
        The callback PDF is useful for callback signatures and ordering, but official Adyen
        documentation remains authoritative. Differences are called out instead of copied silently.
      </Callout>
      <div class="wiki-layout">
        <nav class="wiki-toc" aria-label="Wiki contents">
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <article class="wiki-content">
          <section id="sessions">
            <h2>Sessions Flow</h2>
            <p>
              Create a <code>POST /sessions</code> request on the server and pass only the returned
              <code>id</code> and <code>sessionData</code>{" "}
              to Adyen Web. The final outcome is asynchronous and must be reconciled from the
              AUTHORISATION webhook.
            </p>
            <p>
              Move the shopper to the confirmation page on <code>onPaymentCompleted</code>{" "}
              and let the webhook be the only source of truth for the order. This playground never
              calls{" "}
              <code>GET /sessions/{"{id}"}</code>: Adyen documents that the status it returns is not
              updated, so it must not be polled for the payment's outcome.
            </p>
            <p>
              Since v6.41.0, card installments for Sessions belong in the request-level
              <code>installmentOptions</code>. Checkout API v72 accepts an expiry up to 24 hours;
              the default session expiry is one hour.
            </p>
          </section>
          <section id="advanced">
            <h2>Advanced Flow</h2>
            <p>
              The browser calls your backend for <code>/paymentMethods</code>,{" "}
              <code>/payments</code>
              and{" "}
              <code>/payments/details</code>. The component callback resolves with the backend
              response so Adyen Web can handle redirects, 3DS2 or QR/voucher actions.
            </p>
            <p>
              Drop-in is the all-in-one surface; Components let you mount one payment method. Both
              have the same rule: API keys and merchant credentials stay server-side.
            </p>
          </section>
          <section id="callbacks">
            <h2>Frontend callbacks</h2>
            <p>
              Core callbacks include <code>onSubmit</code>, <code>onAdditionalDetails</code>,
              <code>onPaymentCompleted</code>, <code>onPaymentFailed</code>, <code>onError</code>,
              <code>onChange</code>{" "}
              and payment-method-specific events. This playground records chronological, sanitized
              snapshots. Encrypted fields, sessionData and card data are redacted.
            </p>
            <p>
              Adyen Web 6.41.0 added healthcare data to{" "}
              <code>onBinLookup</code>, validated an invalid
              <code>threeDSNotificationURL</code>{" "}
              in challenge tokens, tightened the TypeScript callback types, and fixed{" "}
              <code>aria-checked</code> when
              <code>openFirstPaymentMethod=false</code>. Up to 6.46.0 it then let the 3DS2 iframe
              run WebAuthn and SPC challenges, added a Sessions <code>onReview</code>{" "}
              callback, kept a Drop-in method's state when another is selected, and allowed a
              disclaimer above the Pay button. 6.47.0 shows a failed gift card balance check to the
              shopper instead of failing silently, and warns when several checkouts are created on
              one page.
            </p>
          </section>
          <section id="webhooks">
            <h2>Webhooks, HMAC & idempotency</h2>
            <p>
              Verify HMAC before business processing, store the event durably, acknowledge it, then
              apply idempotent state transitions. Standard webhooks sign a canonical colon-separated
              field list; newer webhook families can sign the unchanged raw body in headers.
            </p>
            <p>
              Deduplication uses stable event identity, not arrival time. API mutations carry a UUID
              idempotency key capped at 64 characters. Late and out-of-order events update the same
              correlated aggregate.
            </p>
          </section>
          <section id="lifecycle">
            <h2>Capture, cancellation & refund</h2>
            <p>
              Two different things decide what can be done with a payment, and integrations go wrong
              when they are confused: what Adyen supports for the payment method, and how the
              merchant account is set up to capture it.
            </p>
            <Callout title="This playground's merchant account">
              OGAccountECOM captures cards, wallets and the other methods with separate capture
              manually: they stay authorised until captured in the Back Office or the Customer Area.
              PayPal supports separate capture too, but is set to capture on authorisation here.
              Check that the setup you test matches yours; capture can be made immediate in the
              Customer Area (capture delay, for the account or per payment method), or per payment
              with <code>captureDelayHours</code>.
            </Callout>
            <div class="wiki-table-wrap">
              <table class="wiki-table">
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Separate capture</th>
                    <th scope="col">Partial capture</th>
                    <th scope="col">Multiple partial captures</th>
                    <th scope="col">Partial refund</th>
                    <th scope="col">Multiple partial refunds</th>
                    <th scope="col">On this account</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(PAYMENT_METHOD_CAPABILITIES).map((method) => (
                    <tr key={method.paymentMethod}>
                      <th scope="row">
                        <a href={method.sourceUrl} target="_blank" rel="noopener noreferrer">
                          <code>{method.paymentMethod}</code>
                        </a>
                      </th>
                      <td>{method.separateCapture ? "✓" : "✗"}</td>
                      <td>{method.partialCapture ? "✓" : "✗"}</td>
                      <td>{method.multiplePartialCaptures ? "✓" : "✗"}</td>
                      <td>{method.partialRefund ? "✓" : "✗"}</td>
                      <td>{method.multiplePartialRefunds ? "✓" : "✗"}</td>
                      <td>{method.automaticCapture ? "On authorisation" : "Manual capture"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="wiki-source">
              From Adyen's feature table on{" "}
              <a href={CAPABILITIES_SOURCE} target="_blank" rel="noopener noreferrer">
                docs.adyen.com/payment-methods
              </a>, checked{" "}
              {CAPABILITIES_REVIEWED_ON}. Re-checked every three months
              (packages/platform/lifecycle.ts).
            </p>
            <ul>
              <li>
                <strong>Multiple partial captures</strong>{" "}
                also need Adyen Support to enable them on the merchant account. Without that, a
                partial capture is the only one: Adyen cancels what is left.
              </li>
              <li>
                <strong>Refunds</strong>{" "}
                apply to what is captured, and their total never exceeds it. Cancel releases an
                authorisation nothing was captured from.
              </li>
              <li>
                <strong>Every modification is asynchronous.</strong> <code>/captures</code>,{" "}
                <code>/cancels</code> and <code>/refunds</code> answer{" "}
                <code>received</code>; the CAPTURE, CANCELLATION and REFUND webhooks are the
                outcome, and CAPTURE_FAILED, REFUND_FAILED or REFUNDED_REVERSED can overturn a
                success days later. The Back Office keeps a button disabled while its webhook is
                awaited.
              </li>
              <li>
                <strong>Idempotency.</strong> Each request carries an <code>Idempotency-Key</code>
                {" "}
                (a UUID v4, at most 64 characters) minted for that intent and reused on a retry.
                Adyen keeps keys 7 to 14 days and answers a repeat with the first response; a repeat
                still in flight gets HTTP 409 or 422 with error code 704.
              </li>
            </ul>
          </section>
          <section id="partial">
            <h2>Partial payments and multiple attempts</h2>
            <p>
              Checkout <code>/orders</code>{" "}
              combines tenders such as a gift card followed by card. A remaining amount of zero is
              not sufficient to close: wait for all payments to reach final status and for{" "}
              <code>ORDER_CLOSED success=true</code>. Expired or manually cancelled orders close
              with <code>success=false</code>.
            </p>
          </section>
          <section id="pbl">
            <h2>Pay by Link</h2>
            <p>
              Links default to 24 hours and can be configured up to 70 days. Adyen expires a link
              after five unsuccessful attempts. Therefore REFUSED is attempt-level; the order can
              remain open until the effective link status becomes completed or expired.
            </p>
          </section>
          <section id="mit">
            <h2>MIT & tokenization</h2>
            <p>
              Create tokens only after shopper consent. Subsequent merchant-initiated requests use
              <code>storedPaymentMethodId</code>, a non-PII <code>shopperReference</code>,
              <code>shopperInteraction=ContAuth</code>, and either
              <code>Subscription</code> or <code>UnscheduledCardOnFile</code>.
            </p>
          </section>
          <section id="pci">
            <h2>API Only & PCI</h2>
            <p>
              A custom form does not remove PCI obligations. Adyen Custom Card/Secured Fields keeps
              sensitive entry inside secure iframes and sends encrypted values. This server rejects
              raw PAN, CVC and security-code keys and never persists card payloads.
            </p>
          </section>
          <section id="troubleshooting">
            <h2>Troubleshooting</h2>
            <ul>
              <li>
                403 or component load errors: add the exact local/deployed origin to the TEST client
                key.
              </li>
              <li>
                Empty Drop-in: verify merchant payment methods, country, currency and client key.
              </li>
              <li>
                Webhook rejected: configure the endpoint-specific TEST HMAC key and do not reuse
                LIVE keys.
              </li>
              <li>
                Action disabled: inspect method capability, capture state and latest webhook in the
                timeline.
              </li>
              <li>
                3DS redirect loops: verify returnUrl origin and preserve correlation without PII.
              </li>
            </ul>
          </section>
        </article>
      </div>
    </DigitalLayout>
  );
});

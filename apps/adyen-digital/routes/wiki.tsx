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
        description="Maintained against Adyen Web 6.46.0 and Checkout API v72. The supplied callback PDF (v6.40.2) is used as a reviewed secondary source."
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
              disclaimer above the Pay button.
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
              Capture is possible only for authorised, uncaptured methods that support separate
              capture. Cancellation applies before capture; refund applies after capture. Disabled
              actions remain visible with a reason in the Back Office.
            </p>
            <p>
              iDEAL and MB WAY do not support separate capture. They support refunds. PayPal is
              intentionally configured as settlement-only in this playground, even though other
              merchant configurations can support separate/partial capture.
            </p>
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

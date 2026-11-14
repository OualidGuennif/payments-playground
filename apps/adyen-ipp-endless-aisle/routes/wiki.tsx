import { Callout, PageHeader } from "@suite/ui/components.tsx";
import { IppLayout } from "../components/Layout.tsx";
import { define } from "../utils.ts";

export default define.page(function WikiPage() {
  return (
    <IppLayout path="/wiki">
      <PageHeader
        eyebrow="Terminal API reference"
        title="Endless Aisle integration wiki"
        description="A concise operational guide for Adyen Terminal API and the v32 Cloud Device API surface."
      />
      <div class="wiki-layout">
        <nav class="wiki-toc" aria-label="Wiki contents">
          <a href="#architecture">Architecture</a>
          <a href="#request">Payment request</a>
          <a href="#results">Results & polling</a>
          <a href="#webhooks">Event notifications</a>
          <a href="#security">Profiles & security</a>
          <a href="#limits">Hosted limits</a>
        </nav>
        <article class="wiki-content">
          <section id="architecture">
            <h2>Cloud architecture</h2>
            <p>
              This app uses Cloud Device API TEST endpoints. The POS sends a Terminal API
              <code>SaleToPOIRequest</code>{" "}
              through Adyen to the configured device. The POIID must match the device id in the URL
              and in <code>MessageHeader</code>.
            </p>
            <Callout title="Verified library surface">
              `@adyen/api-library` 32.3.0 exports CloudDeviceAPI and its synchronous, asynchronous,
              device-list and status operations. No API call is made until Real TEST is explicitly
              selected.
            </Callout>
          </section>
          <section id="request">
            <h2>Payment request</h2>
            <p>
              The header carries ProtocolVersion 3.0, MessageClass Service, MessageCategory Payment,
              MessageType Request, a short ServiceID, SaleID and POIID. The amount is sent in major
              units under <code>PaymentTransaction.AmountsReq</code>.
            </p>
          </section>
          <section id="results">
            <h2>Results, retries & cancellation</h2>
            <p>
              A synchronous cloud request can remain open for more than 150 seconds. The UI shows a
              deliberate progress state and preserves the local order even on transport failure.
              Operator cancellation is idempotently audited; the exact terminal abort behavior
              depends on the current device transaction state.
            </p>
          </section>
          <section id="webhooks">
            <h2>Event notifications</h2>
            <p>
              Async Terminal API responses are accepted at{" "}
              <code>/webhook</code>. Optional Basic Auth and header HMAC are checked when
              configured. Payloads are sanitized, deduplicated and correlated by ServiceID.
            </p>
          </section>
          <section id="security">
            <h2>Profiles & security</h2>
            <p>
              Secrets are posted directly to the backend, AES-GCM encrypted in SQLite, and never
              returned. A hosted deployment must provide{" "}
              <code>PROFILE_ENCRYPTION_KEY</code>. The preferred non-secret profile id is stored in
              a signed HttpOnly cookie.
            </p>
          </section>
          <section id="limits">
            <h2>Hosted playground limits</h2>
            <p>
              Render cannot make a disconnected terminal reachable. Real TEST requires Terminal API,
              the Cloud Device API role, an online TEST device, allowed network egress and correct
              merchant ownership. Mock results are labeled local simulation and never represented as
              Adyen responses.
            </p>
          </section>
        </article>
      </div>
    </IppLayout>
  );
});

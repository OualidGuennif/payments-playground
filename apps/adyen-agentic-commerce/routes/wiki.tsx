import { Callout, PageHeader } from "@suite/ui/components.tsx";
import { AgenticLayout } from "../components/Layout.tsx";
import { define } from "../utils.ts";

export default define.page(function WikiPage() {
  return (
    <AgenticLayout path="/wiki">
      <PageHeader
        eyebrow="Architecture & limits"
        title="Agentic Commerce wiki"
        description="What is executable today, what is simulated, and what requires commercial pilot access."
      />
      <div class="wiki-layout">
        <nav class="wiki-toc" aria-label="Wiki contents">
          <a href="#model">Architecture</a>
          <a href="#auth">Authentication</a>
          <a href="#mock">Mock contract</a>
          <a href="#payment">Payment handoff</a>
          <a href="#limits">Current limits</a>
          <a href="#production">Production path</a>
        </nav>
        <article class="wiki-content">
          <section id="model">
            <h2>Merchant-first architecture</h2>
            <p>
              Agentic commerce delegates discovery and purchase intent, but the merchant retains
              catalogue truth, policy enforcement, human confirmation rules and an auditable
              mandate. Provider adapters sit behind a narrow interface so protocols can change
              without rewriting payment or fulfilment logic.
            </p>
          </section>
          <section id="auth">
            <h2>Authentication</h2>
            <p>
              Adyen Checkout keeps its API key server-side and exposes only the publishable TEST
              client key to Adyen Web. Any future agent-provider bearer remains encrypted
              server-side. A token never proves an endpoint or schema: both must come from the
              pilot's authoritative contract.
            </p>
          </section>
          <section id="mock">
            <h2>Local mock contract</h2>
            <p>
              The mock runs deterministic intent capture, merchant policy and catalogue ranking.
              External agent reasoning is a fixture with <code>status=simulated</code>,
              <code>provider=null</code> and{" "}
              <code>calledExternalProvider=false</code>. It is not presented as an OpenAI, Copilot,
              Google or Adyen response.
            </p>
          </section>
          <section id="payment">
            <h2>Human-confirmed payment handoff</h2>
            <p>
              After reviewing the offer, the user can explicitly create a standard Checkout API v72
              session and complete it with Adyen Web 6.47.0. This is a real Adyen TEST online
              payment call when credentials are configured, but it is not described as an Agentic
              Commerce API call.
            </p>
          </section>
          <section id="limits">
            <h2>Current availability</h2>
            <Callout title="Pilot status" tone="warning">
              Adyen's current public material describes payment support for OpenAI, Google and
              Microsoft surfaces as pilot-phase. No public TEST API schema was verifiable for this
              implementation, so Real Agentic mode returns an explicit 501 without making a request.
            </Callout>
          </section>
          <section id="production">
            <h2>Path to production</h2>
            <ol>
              <li>
                Obtain pilot documentation, environment-specific credentials and allowed endpoints.
              </li>
              <li>Implement a provider adapter with signed mandate and replay protection.</li>
              <li>Verify liability, consent, fraud, cancellation and dispute ownership.</li>
              <li>Contract-test the adapter against official schemas and pilot TEST fixtures.</li>
              <li>Keep human override, spend limits and end-to-end audit retention.</li>
            </ol>
          </section>
        </article>
      </div>
    </AgenticLayout>
  );
});

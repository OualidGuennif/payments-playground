import type { ComponentChildren } from "preact";
import { type FlowInfo, FLOWS } from "../components/flows.ts";
import { DigitalLayout } from "../components/Layout.tsx";
import { define } from "../utils.ts";

function Card(
  props: { href: string; title: string; children: ComponentChildren; badge?: string },
) {
  return (
    <a class="home-card" href={props.href}>
      <span class="home-card__body">
        <span class="home-card__title">
          {props.title}
          {props.badge ? <span class="home-card__badge">{props.badge}</span> : null}
        </span>
        <span class="home-card__text">{props.children}</span>
      </span>
      <span class="home-card__arrow" aria-hidden="true">→</span>
    </a>
  );
}

function flowHref(flow: FlowInfo): string {
  return flow.hasIntegration ? `/${flow.id}?integration=dropin` : `/${flow.id}`;
}

export default define.page(function Home() {
  const checkout = FLOWS.filter((flow) => flow.group === "checkout");
  const beyond = FLOWS.filter((flow) => flow.group === "beyond");
  return (
    <DigitalLayout path="/">
      <div class="home">
        <section class="home-group">
          <h2>Checkout flows</h2>
          <div class="home-grid">
            {checkout.map((flow) => (
              <Card
                key={flow.id}
                href={flowHref(flow)}
                title={flow.title}
                badge={flow.recommended ? "Recommended" : undefined}
              >
                {flow.description}
              </Card>
            ))}
          </div>
        </section>

        <section class="home-group">
          <h2>Beyond checkout</h2>
          <div class="home-grid">
            {beyond.map((flow) => (
              <Card key={flow.id} href={flowHref(flow)} title={flow.title}>
                {flow.description}
              </Card>
            ))}
            <Card href="/back-office" title="Back Office">
              Every order with its attempts, API calls and webhooks; capture, cancel or refund.
            </Card>
          </div>
        </section>
      </div>
    </DigitalLayout>
  );
});

import type { ReactNode } from "react";
import { type FlowInfo, FLOWS } from "@/checkout/flows.ts";
import { DigitalLayout } from "@/components/Layout.tsx";

function Card(props: { href: string; title: string; children: ReactNode; badge?: string }) {
  return (
    <a className="home-card" href={props.href}>
      <span className="home-card__body">
        <span className="home-card__title">
          {props.title}
          {props.badge ? <span className="home-card__badge">{props.badge}</span> : null}
        </span>
        <span className="home-card__text">{props.children}</span>
      </span>
      <span className="home-card__arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}

function flowHref(flow: FlowInfo): string {
  return flow.hasIntegration ? `/${flow.id}?integration=dropin` : `/${flow.id}`;
}

export default function Home() {
  const checkout = FLOWS.filter((flow) => flow.group === "checkout");
  const beyond = FLOWS.filter((flow) => flow.group === "beyond");
  return (
    <DigitalLayout path="/">
      <div className="home">
        <section className="home-group">
          <h2>Checkout flows</h2>
          <div className="home-grid">
            {checkout.map((flow) => (
              <Card
                key={flow.id}
                href={flowHref(flow)}
                title={flow.label}
                badge={flow.recommended ? "Recommended" : undefined}
              >
                {flow.description}
              </Card>
            ))}
          </div>
        </section>

        <section className="home-group">
          <h2>Beyond checkout</h2>
          <div className="home-grid">
            {beyond.map((flow) => (
              <Card key={flow.id} href={flowHref(flow)} title={flow.label}>
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
}

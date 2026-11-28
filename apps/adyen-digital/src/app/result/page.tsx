import { DigitalLayout } from "@/components/Layout.tsx";
import RedirectReturn from "@/components/workbench/RedirectReturn.tsx";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The returnUrl of every digital payment. A redirect method lands here with a
 * redirectResult: a Sessions payment also brings its sessionId and Adyen Web
 * submits it through the session (ADR-023); an Advanced one is submitted by
 * the server to /payments/details.
 */
export default async function ResultPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const orderId = first(query.orderId);
  return (
    <DigitalLayout path="/result">
      <div className="return-page">
        {orderId ? (
          <RedirectReturn
            orderId={orderId}
            redirectResult={first(query.redirectResult)}
            sessionId={first(query.sessionId)}
          />
        ) : (
          <div className="return-card">
            <p>This page is where a payment method sends the shopper back.</p>
            <a className="button button--primary" href="/sessions?integration=dropin">
              Start a checkout
            </a>
          </div>
        )}
      </div>
    </DigitalLayout>
  );
}

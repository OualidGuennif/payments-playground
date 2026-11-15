import { DigitalLayout } from "@/components/Layout.tsx";
import RedirectReturn from "@/components/RedirectReturn.tsx";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The returnUrl of every digital payment. A redirect method lands here with a
 * redirectResult, which the island submits so the order settles before any
 * webhook arrives.
 */
export default async function ResultPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const orderId = first(query.orderId);
  return (
    <DigitalLayout path="/result">
      <div className="return-page">
        {orderId ? (
          <RedirectReturn orderId={orderId} redirectResult={first(query.redirectResult)} />
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

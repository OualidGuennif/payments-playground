import { DigitalLayout } from "../components/Layout.tsx";
import RedirectReturn from "../islands/RedirectReturn.tsx";
import { define } from "../utils.ts";

/**
 * The returnUrl of every digital payment. A redirect method lands here with a
 * redirectResult, which the island submits so the order settles before any
 * webhook arrives.
 */
export default define.page(function ResultPage({ url }) {
  const orderId = url.searchParams.get("orderId");
  return (
    <DigitalLayout path="/result">
      <div class="return-page">
        {orderId
          ? (
            <RedirectReturn
              orderId={orderId}
              redirectResult={url.searchParams.get("redirectResult")}
            />
          )
          : (
            <div class="return-card">
              <p>This page is where a payment method sends the shopper back.</p>
              <a class="button button--primary" href="/sessions?integration=dropin">
                Start a checkout
              </a>
            </div>
          )}
      </div>
    </DigitalLayout>
  );
});

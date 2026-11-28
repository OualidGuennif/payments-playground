// Spec: knowledge/components/adyen-digital.md
// A Sessions payment that redirected comes back with its sessionId and a redirectResult. As
// Adyen's Sessions guide says, Adyen Web finishes it: a checkout created from that sessionId
// submits the redirectResult through the session, and the merchant server stays out of it; the
// order follows the AUTHORISATION webhook (ADR-023).
import { AdyenCheckout } from "@adyen/adyen-web";

export interface SessionRedirectResult {
  /** onPaymentCompleted's or onPaymentFailed's result. */
  result: unknown;
  failed: boolean;
}

export function completeSessionRedirect(input: {
  clientKey: string;
  sessionId: string;
  redirectResult: string;
}): Promise<SessionRedirectResult> {
  return new Promise((resolve, reject) => {
    AdyenCheckout({
      environment: "test",
      clientKey: input.clientKey,
      // With only the id, Adyen Web sets the session up from the sessionData it kept in its own
      // localStorage when the payment was made, and the setup answer brings the country.
      session: { id: input.sessionId },
      analytics: { enabled: false },
      onPaymentCompleted: (result) => resolve({ result, failed: false }),
      onPaymentFailed: (result) => resolve({ result, failed: true }),
      // A session that cannot be set up or answer comes here first; the promise keeps that
      // reason over the onPaymentFailed that follows it.
      onError: (error) => reject(error),
    }).then(
      (checkout) => checkout.submitDetails({ details: { redirectResult: input.redirectResult } }),
      reject,
    );
  });
}

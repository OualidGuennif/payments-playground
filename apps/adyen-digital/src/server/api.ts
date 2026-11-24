// Spec: knowledge/components/adyen-digital.md
// The digital playground's API: the platform's shared routes (health, bootstrap,
// profiles, inspector), then one plugin per flow. Each route file mirrors the
// Checkout API endpoints its flow calls; the helpers they share sit beside this file.
import { createPlatformApi, serveSecurely } from "@suite/platform/base-api.ts";
import { context } from "./context.ts";
import { backOfficeRoutes } from "./routes/back-office.ts";
import { sessionsRoutes } from "./routes/sessions.ts";
import { advancedRoutes } from "./routes/advanced.ts";
import { partialPaymentRoutes } from "./routes/partial-payments.ts";
import { payByLinkRoutes } from "./routes/pay-by-link.ts";
import { mitRoutes } from "./routes/mit.ts";
import { apiOnlyRoutes } from "./routes/api-only.ts";
import { webhookRoutes } from "./routes/webhooks.ts";

const app = createPlatformApi(context)
  .use(backOfficeRoutes)
  .use(sessionsRoutes)
  .use(advancedRoutes)
  .use(partialPaymentRoutes)
  .use(payByLinkRoutes)
  .use(mitRoutes)
  .use(apiOnlyRoutes)
  .use(webhookRoutes);

export type App = typeof app;
export const handle = serveSecurely(app, context);

/**
 * /api/bootstrap answered in-process for a page render, with the page
 * request's headers so the preferred-profile cookie applies. Cookies it would
 * issue are dropped: src/proxy.ts sets them on the page response.
 */
export async function bootstrapFor(incoming: Headers): Promise<unknown> {
  const response = await app.handle(
    new Request("http://internal/api/bootstrap", { headers: new Headers(incoming) }),
  );
  return await response.json();
}

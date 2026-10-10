import { page } from "fresh";
import { api } from "../api.ts";
import { isFlow } from "../components/flows.ts";
import { DigitalLayout } from "../components/Layout.tsx";
import FlowWorkbench, { type Bootstrap } from "../islands/FlowWorkbench.tsx";
import { define } from "../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const flow = ctx.params.flow;
    if (!isFlow(flow)) {
      return new Response("Not found", { status: 404 });
    }
    // Fetching /api/bootstrap in-process (same Hono app, no real network hop)
    // before the first paint removes the client-side fetch-after-hydration
    // gap that used to flash a "loading" state on every flow page.
    const bootstrapRequest = new Request(new URL("/api/bootstrap", ctx.req.url), {
      headers: ctx.req.headers,
    });
    const bootstrapResponse = await api.fetch(bootstrapRequest);
    const bootstrap = await bootstrapResponse.json() as Bootstrap;
    const headers = new Headers();
    for (const cookie of bootstrapResponse.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    const integration: "dropin" | "component" =
      new URL(ctx.req.url).searchParams.get("integration") === "component" ? "component" : "dropin";
    return page({ flow, bootstrap, integration }, { headers });
  },
});

export default define.page<typeof handler>(function FlowPage({ data }) {
  const { flow, bootstrap, integration } = data;
  return (
    <DigitalLayout path={`/${flow}`}>
      <FlowWorkbench flow={flow} initialBootstrap={bootstrap} initialIntegration={integration} />
    </DigitalLayout>
  );
});

// Spec: knowledge/components/adyen-ipp-endless-aisle.md
import { App, staticFiles } from "fresh";
import { applySecurityHeaders, basicAuthChallenge } from "@suite/platform/security.ts";
import { api } from "./api.ts";
import { define, type State } from "./utils.ts";

export const app = new App<State>();
// First, so optional Basic Auth covers pages and static files, not only the API.
app.use(define.middleware((ctx) => {
  const challenge = basicAuthChallenge(ctx.req);
  if (!challenge) return ctx.next();
  applySecurityHeaders(challenge.headers);
  return challenge;
}));
app.use(staticFiles());
app.use(define.middleware(async (ctx) => {
  ctx.state.requestId = crypto.randomUUID();
  const path = new URL(ctx.req.url).pathname;
  if (path.startsWith("/api/") || path === "/healthz" || path === "/webhook") {
    const apiResponse = await api.fetch(ctx.req);
    applySecurityHeaders(apiResponse.headers);
    return apiResponse;
  }
  const response = await ctx.next();
  applySecurityHeaders(response.headers);
  return response;
}));
app.fsRoutes();

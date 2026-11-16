// Spec: knowledge/components/adyen-agentic-commerce.md
// One Elysia instance for every server route. Next.js route files under src/app re-export `handle`
// for their paths, so the request URL each handler sees is the public path (PAP's htu needs it).
import { Elysia, status } from "elysia";
import { productSvg } from "./art";
import * as adyen from "./adyen";
import { productById, variantById } from "./catalog";
import * as commerce from "./commerce";
import { config, paymentsConfigured, SHOPPER_REFERENCE, UCP_VERSION } from "./config";
import { get, list } from "./db";
import * as oauth from "./oauth";
import { poppyDocument } from "./pap";
import { handleMcp, handleRest } from "./protocol";
import { recentTrace, trace } from "./trace";
import { handlerSchema, profile } from "./ucp";
import { openApi } from "./openapi";
import { isRecord, json, safeEqual } from "./util";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, ucp-agent, request-id, idempotency-key, poppy-session, poppy-version",
  "access-control-expose-headers": "www-authenticate, request-id, retry-after",
  "access-control-max-age": "600",
};

function withCors(response: Response): Response {
  for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
  return response;
}

function oauthError(error: unknown): Response {
  if (error instanceof oauth.OAuthError) {
    return json(error.status, { error: error.code, error_description: error.message });
  }
  throw error;
}

async function formOf(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return new URLSearchParams(
      isRecord(body) ? Object.entries(body).map(([k, v]) => [k, String(v)]) : [],
    );
  }
  return new URLSearchParams(await request.text());
}

export function backOfficeAllowed(header: string | null): boolean {
  const cfg = config().backOffice;
  if (!cfg) return true;
  const match = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!match) return false;
  const decoded = Buffer.from(match[1]!, "base64").toString();
  return safeEqual(decoded, `${cfg.user}:${cfg.password}`);
}

const browserApi = new Elysia({ prefix: "/api" })
  .get("/art/:file", ({ params }) => {
    const variant = variantById(params.file.replace(/\.svg$/, ""));
    const product = variant && productById(variant.productId);
    if (!variant || !product) return status(404, "Not found");
    return new Response(productSvg(product.shape, variant.colour), {
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
    });
  })
  .post("/checkouts", ({ body }) => {
    try {
      const input = isRecord(body) ? body : {};
      const lines = Array.isArray(input.lines) ? input.lines : [];
      const checkout = commerce.createCheckout({
        line_items: lines.map((l) =>
          isRecord(l) ? { item: { id: String(l.variantId) }, quantity: Number(l.quantity) } : l,
        ),
        buyer: input.email
          ? {
              email: String(input.email),
              first_name: input.firstName ? String(input.firstName) : undefined,
              last_name: input.lastName ? String(input.lastName) : undefined,
            }
          : undefined,
      });
      trace({
        channel: "web",
        actor: "shopper",
        method: "POST",
        path: "/api/checkouts",
        status: 201,
        ref: checkout.id,
        detail: { lines: checkout.lines },
      });
      return { id: checkout.id };
    } catch (error) {
      if (error instanceof commerce.CommerceError)
        return status(error.status, { error: error.msg.content });
      throw error;
    }
  })
  .get("/checkouts/:id", ({ params }) => {
    try {
      return checkoutView(commerce.loadCheckout(params.id, "browser"));
    } catch {
      return status(404, { error: "Checkout not found" });
    }
  })
  .post("/checkouts/:id/session", async ({ params }) => {
    try {
      return await commerce.startShopperSession(commerce.loadCheckout(params.id, "browser"));
    } catch (error) {
      if (error instanceof commerce.CommerceError)
        return status(error.status, { error: error.msg.content });
      return status(502, { error: "The payment session could not be created" });
    }
  })
  .post("/checkouts/:id/session-result", async ({ params, body }) => {
    const input = isRecord(body) ? body : {};
    try {
      const checkout = await commerce.finishShopperSession(
        commerce.loadCheckout(params.id, "browser"),
        String(input.sessionId ?? ""),
        String(input.sessionResult ?? ""),
      );
      return checkoutView(checkout);
    } catch (error) {
      if (error instanceof commerce.CommerceError)
        return status(error.status, { error: error.msg.content });
      return status(502, { error: "Adyen could not confirm the session" });
    }
  })
  .get("/account", async () => accountView())
  .post("/account/card-session", async () => {
    try {
      return await commerce.startCardSave();
    } catch {
      return status(502, { error: "The card session could not be created" });
    }
  })
  .post("/account/card-result", async ({ body }) => {
    const input = isRecord(body) ? body : {};
    try {
      const result = await commerce.finishCardSave(
        String(input.sessionId ?? ""),
        String(input.sessionResult ?? ""),
      );
      return { result, account: await accountView(true) };
    } catch {
      return status(502, { error: "Adyen could not confirm the card" });
    }
  })
  .delete("/account/cards/:alias", async ({ params }) => {
    const card = (await commerce.savedCards(true)).find((c) => c.alias === params.alias);
    if (!card) return status(404, { error: "Unknown card" });
    await adyen.forgetCard(card.storedPaymentMethodId);
    commerce.forgetCardCache();
    trace({
      channel: "web",
      actor: "shopper",
      method: "DELETE",
      path: "/storedPaymentMethods",
      status: 200,
      ref: params.alias,
      detail: { brand: card.brand, lastFour: card.lastFour },
    });
    return accountView(true);
  })
  .post("/account/grants/:id", async ({ params, body }) => {
    const input = isRecord(body) ? body : {};
    const grant = oauth.updateGrant(params.id, {
      revoked: input.revoked === true ? true : undefined,
      spendLimit: typeof input.spendLimit === "number" ? input.spendLimit : undefined,
    });
    if (!grant) return status(404, { error: "Unknown agent" });
    trace({
      channel: "web",
      actor: "shopper",
      method: "POST",
      path: "/account/grants",
      status: 200,
      ref: grant.id,
      detail: { revoked: grant.revoked, spendLimit: grant.spendLimit },
    });
    return accountView();
  })
  .get("/back-office", ({ request }) => {
    if (!backOfficeAllowed(request.headers.get("authorization")))
      return status(401, { error: "Back Office sign-in required" });
    return backOfficeView();
  })
  .post("/webhooks/adyen", async ({ request }) => {
    const payload = await request.json().catch(() => undefined);
    const items =
      isRecord(payload) && Array.isArray(payload.notificationItems)
        ? payload.notificationItems
        : [];
    let invalid = 0;
    for (const wrapper of items) {
      const item = (isRecord(wrapper) ? wrapper.NotificationRequestItem : undefined) as
        | adyen.NotificationItem
        | undefined;
      if (!item) continue;
      const valid = adyen.validHmac(item);
      const outcome = valid ? commerce.applyNotification(item) : "rejected: HMAC";
      if (!valid) invalid += 1;
      trace({
        channel: "webhook",
        actor: "adyen",
        method: "POST",
        path: "/api/webhooks/adyen",
        status: valid ? 200 : 401,
        ref: item.merchantReference ?? null,
        detail: {
          eventCode: item.eventCode,
          success: item.success,
          pspReference: item.pspReference,
          merchantReference: item.merchantReference,
          hmacValid: valid,
          outcome,
        },
      });
    }
    if (!items.length || invalid) return status(401, "[rejected]");
    return new Response("[accepted]", { headers: { "content-type": "text/plain" } });
  });

export function checkoutView(checkout: commerce.Checkout) {
  const assessment = commerce.assess(checkout, undefined, []);
  const priced = commerce.price(checkout.lines);
  const order = checkout.orderId ? get<commerce.Order>("orders", checkout.orderId) : undefined;
  return {
    id: checkout.id,
    phase: checkout.phase,
    status: assessment.status,
    messages: assessment.messages.filter(
      (m) => m.code !== "payments_unavailable" && m.code !== "sign_in_required",
    ),
    agentName: checkout.agentName,
    lines: priced.items.map(({ line, variant, amount }) => ({
      id: line.id,
      variantId: variant.id,
      title: variant.title,
      quantity: line.quantity,
      unitPrice: variant.price,
      amount,
    })),
    subtotal: priced.subtotal,
    fulfillment: priced.fulfillment,
    total: priced.total,
    buyer: checkout.buyer,
    order: order
      ? {
          id: order.id,
          status: order.status,
          pspReference: order.pspReference,
          paidBy: order.paidBy,
        }
      : undefined,
    paymentsReady: paymentsConfigured(),
  };
}

export async function accountView(refresh = false) {
  const cards = await commerce.savedCards(refresh);
  return {
    shopperReference: SHOPPER_REFERENCE,
    paymentsReady: paymentsConfigured(),
    cards: cards.map(({ storedPaymentMethodId: _hidden, ...card }) => card),
    agents: oauth.grants().map((g) => ({
      id: g.id,
      clientId: g.clientId,
      name: g.clientName,
      scopes: g.scopes,
      spendLimit: g.spendLimit,
      spent: g.spent,
      revoked: g.revoked,
      createdAt: g.createdAt,
      tokenIssuedAt: g.tokenIssuedAt,
      firstUsedAt: g.firstUsedAt,
      lastUsedAt: g.lastUsedAt,
    })),
    orders: list<commerce.Order>("orders", 50).map((o) => ({
      id: o.id,
      total: o.total,
      status: o.status,
      paidBy: o.paidBy,
      agentName: o.agentName,
      createdAt: o.createdAt,
    })),
  };
}

export function backOfficeView() {
  return {
    orders: list<commerce.Order>("orders", 100),
    payments: list<commerce.PaymentRecord>("payments", 100),
    checkouts: list<commerce.Checkout>("checkouts", 100).map((c) => ({
      id: c.id,
      phase: c.phase,
      agentName: c.agentName,
      total: commerce.price(c.lines).total,
      attempts: c.attempts,
      orderId: c.orderId,
      createdAt: c.createdAt,
    })),
    trace: recentTrace(200),
  };
}

const app = new Elysia()
  .onRequest(({ request }) =>
    request.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS }) : undefined,
  )
  .onAfterHandle(({ request, responseValue }) => {
    const path = new URL(request.url).pathname;
    if (responseValue instanceof Response && !path.startsWith("/api/")) withCors(responseValue);
  })
  .get("/healthz", () => ({
    status: "ok",
    environment: "TEST",
    payments: paymentsConfigured(),
    ucp: UCP_VERSION,
    pap: "1.0",
  }))
  .get("/.well-known/poppy.json", () => withCors(json(200, poppyDocument())))
  .get("/.well-known/ucp", () => withCors(json(200, profile())))
  .get("/.well-known/oauth-authorization-server", () =>
    withCors(json(200, oauth.authorizationServerMetadata())),
  )
  .get("/.well-known/oauth-protected-resource", () =>
    withCors(json(200, oauth.protectedResourceMetadata(config().publicOrigin))),
  )
  .get("/.well-known/oauth-protected-resource/mcp", () =>
    withCors(json(200, oauth.protectedResourceMetadata(`${config().publicOrigin}/mcp`))),
  )
  .get("/oauth/authorize", async ({ request }) => {
    const outcome = await oauth.startAuthorization(new URL(request.url).searchParams);
    if (outcome.kind === "consent")
      return Response.redirect(`${config().publicOrigin}/consent/${outcome.requestId}`, 302);
    if (outcome.kind === "redirect") return Response.redirect(outcome.location, 302);
    return new Response(`Sign-in refused: ${outcome.error}. ${outcome.description}`, {
      status: outcome.status,
      headers: { "content-type": "text/plain" },
    });
  })
  .post("/oauth/decision", async ({ request }) => {
    const form = await formOf(request);
    try {
      const location = oauth.decide({
        requestId: form.get("request") ?? "",
        approve: form.get("decision") === "approve",
        scopes: form.getAll("scope"),
        spendLimit: Math.round(Number(form.get("spend_limit_eur") ?? "0") * 100),
      });
      return new Response(null, { status: 303, headers: { location } });
    } catch (error) {
      return oauthError(error);
    }
  })
  .post("/oauth/device_authorization", async ({ request }) => {
    try {
      const answer = await oauth.startDeviceAuthorization(await formOf(request));
      // The device code is a secret and the user code half of one: neither goes to the trace.
      trace({
        channel: "oauth",
        actor: "agent",
        method: "POST",
        path: "/oauth/device_authorization",
        status: 200,
        ref: null,
        detail: { expires_in: answer.expires_in, interval: answer.interval },
      });
      return json(200, answer);
    } catch (error) {
      if (error instanceof oauth.OAuthError) {
        trace({
          channel: "oauth",
          actor: "agent",
          method: "POST",
          path: "/oauth/device_authorization",
          status: error.status,
          ref: null,
          detail: { error: error.code, why: error.message },
        });
      }
      return oauthError(error);
    }
  })
  // The shopper's form on /device. A right code opens the consent page; anything else goes back
  // to /device with the reason, so the page itself never needs to read the database.
  .post("/oauth/device/verify", async ({ request }) => {
    const form = await formOf(request);
    const typed = (form.get("user_code") ?? "").replace(/[^A-Za-z-]/g, "").slice(0, 12);
    // The first X-Forwarded-For entry, as for shopperIP elsewhere. A forged one only moves the
    // guesses to another bucket; the total limit in verifyUserCode still bounds them.
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const outcome = oauth.verifyUserCode(typed, address);
    const origin = config().publicOrigin;
    if ("requestId" in outcome) {
      return new Response(null, {
        status: 303,
        headers: { location: `${origin}/consent/${outcome.requestId}` },
      });
    }
    const back = new URL(`${origin}/device`);
    back.searchParams.set("error", outcome.error);
    if (typed) back.searchParams.set("user_code", typed);
    return new Response(null, { status: 303, headers: { location: back.href } });
  })
  .post("/oauth/token", async ({ request }) => {
    try {
      const tokens = await oauth.tokenEndpoint(await formOf(request));
      trace({
        channel: "oauth",
        actor: "agent",
        method: "POST",
        path: "/oauth/token",
        status: 200,
        ref: null,
        detail: { scope: tokens.scope },
      });
      return json(200, tokens);
    } catch (error) {
      if (error instanceof oauth.OAuthError) {
        trace({
          channel: "oauth",
          actor: "agent",
          method: "POST",
          path: "/oauth/token",
          status: error.status,
          ref: null,
          detail: { error: error.code, why: error.message },
        });
      }
      return oauthError(error);
    }
  })
  .post("/oauth/revoke", async ({ request }) => {
    try {
      await oauth.revokeEndpoint(await formOf(request));
      return new Response(null, { status: 200 });
    } catch (error) {
      return oauthError(error);
    }
  })
  .post("/oauth/register", async ({ request }) => {
    try {
      const client = oauth.registerClient(await request.json().catch(() => undefined));
      trace({
        channel: "oauth",
        actor: client.name,
        method: "POST",
        path: "/oauth/register",
        status: 201,
        ref: client.clientId,
        detail: { redirect_uris: client.redirectUris, grant_types: client.grantTypes },
      });
      const grantTypes = client.grantTypes ?? [];
      return json(201, {
        client_id: client.clientId,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: grantTypes,
        response_types: grantTypes.includes("authorization_code") ? ["code"] : [],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      });
    } catch (error) {
      return oauthError(error);
    }
  })
  .get("/ucp/v1/openapi.json", () => json(200, openApi()))
  .get("/ucp/v1/handlers/saved_card.json", () => json(200, handlerSchema()))
  .all("/ucp/v1/*", ({ request, params }) => handleRest(request, `/${params["*"]}`))
  .all("/mcp", ({ request }) => handleMcp(request))
  .use(browserApi);

export type App = typeof app;

export const handle = (request: Request) => app.fetch(request);

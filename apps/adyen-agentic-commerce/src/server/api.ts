// Spec: knowledge/components/adyen-agentic-commerce.md
// One Elysia instance for every server route. Next.js route files under src/app re-export `handle`
// for their paths, so the request URL each handler sees is the public path (PAP's htu needs it).
import { Elysia, status } from "elysia";
import { accountApi, customerOf, sessionLimit } from "./accounts/account-api";
import { askApi } from "./ask/api";
import { consoleApi } from "./ask/console-api";
import { voiceApi } from "./ask/voice-api";
import { productSvg, welcomeToteSvg } from "./catalog/art";
import { feedJsonl, openAiFeed } from "./catalog/openai-feed";
import * as adyen from "./payments/adyen";
import * as backOffice from "./back-office/back-office";
import { productById, searchProducts, variantById, variantsOf } from "./catalog/catalog";
import * as commerce from "./commerce/commerce";
import { config, paymentsConfigured, UCP_VERSION } from "./core/config";
import type { Customer } from "./accounts/customers";
import { get, list } from "./core/db";
import * as oauth from "./oauth/oauth";
import { poppyDocument } from "./pap/pap";
import { clientIp, handleCodeMcp, handleMcp, handleRest, rateLimited } from "./protocol";
import { handleFeedback, handleTasks } from "./pap/tasks";
import { trace } from "./core/trace";
import { handlerSchema, networkTokenSchema, profile } from "./ucp/ucp";
import { openApi } from "./ucp/openapi";
import { isRecord, json, published, safeEqual } from "./core/util";
import { DEFAULT_DELIVERY, parseDelivery } from "../lib/delivery";
import { maskEmails } from "../lib/mask";
import { seasonOfGift } from "../lib/seasons";
import { shopperWords } from "../lib/shopper-words";
import { PLUGIN_ZIP_PATH, pluginZip } from "./mcp/widgets";

// A browser route's refusal: the shopper's sentence and the code the page acts on, never the
// store's text for agents, which names fields and states.
const refused = (httpStatus: number, code: string) =>
  status(httpStatus, { error: shopperWords(code), code });
const refusedBy = (error: commerce.CommerceError) => refused(error.status, error.msg.code);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, ucp-agent, request-id, idempotency-key, poppy-session, poppy-version, poppy-extensions",
  "access-control-expose-headers": "www-authenticate, request-id, retry-after",
  "access-control-max-age": "600",
};

function withCors(response: Response): Response {
  for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
  return response;
}

// Consent and device approval belong to an account: without one the shopper signs in and comes
// back to the same page.
function signInFirst(next: string): Response {
  const url = new URL(`${config().publicOrigin}/sign-in`);
  url.searchParams.set("next", next);
  return new Response(null, { status: 303, headers: { location: url.href } });
}

function oauthError(error: unknown): Response {
  if (error instanceof oauth.OAuthError) {
    return json(error.status, { error: error.code, error_description: error.message });
  }
  throw error;
}

// The per-address limit agents share across UCP, /mcp and the OAuth endpoints that do work.
function agentLimit(request: Request): Response | undefined {
  const retry = rateLimited(clientIp(request));
  return retry ? json(429, { error: "rate_limited" }, { "retry-after": String(retry) }) : undefined;
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

const RETURN_DEST = /^\/(account|checkout\/chk_[A-Za-z0-9_-]+)$/;
const RETURN_FIELDS = ["sessionId", "redirectResult", "payload", "ref"] as const;

// Adyen 3DS returns by GET or cross-site form POST; landing on /api/return converts both to a
// same-origin 303 GET so SameSite=Lax cookies stay attached and Next App Router renders cleanly.
async function redirectFromAdyen(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const to = url.searchParams.get("to") ?? "";
  if (!RETURN_DEST.test(to)) return json(400, { error: "Invalid return destination" });
  const form =
    request.method.toUpperCase() === "POST" ? await formOf(request) : new URLSearchParams();
  const target = new URL(`${config().publicOrigin}${to}`);
  for (const key of RETURN_FIELDS) {
    const value = form.get(key) ?? url.searchParams.get(key);
    if (typeof value === "string" && value.length > 0 && value.length <= 8192)
      target.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 303,
    headers: { location: target.href, "cache-control": "no-store" },
  });
}

const FEED_CACHE = "public, max-age=300";

const browserApi = new Elysia({ prefix: "/api" })
  .get("/return", ({ request }) => redirectFromAdyen(request))
  .post("/return", ({ request }) => redirectFromAdyen(request))
  .get("/art/:file", ({ params }) => {
    const name = params.file.replace(/\.svg$/, "");
    // The welcome tote is a gift, never a catalogue variant: only its four names are drawn.
    const season = seasonOfGift(name);
    if (season)
      return new Response(welcomeToteSvg(season), {
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" },
      });
    const variant = variantById(name);
    const product = variant && productById(variant.productId);
    if (!variant || !product) return status(404, "Not found");
    return new Response(productSvg(product.shape, variant.colour), {
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
    });
  })
  // The OpenAI product feed, public like the shop pages; built per request from the origin.
  .get(
    "/feeds/openai.json",
    () =>
      new Response(JSON.stringify({ items: openAiFeed(config().publicOrigin) }), {
        headers: { "content-type": "application/json", "cache-control": FEED_CACHE },
      }),
  )
  .get(
    "/feeds/openai.jsonl",
    () =>
      new Response(feedJsonl(openAiFeed(config().publicOrigin)), {
        headers: {
          "content-type": "application/jsonl; charset=utf-8",
          "cache-control": FEED_CACHE,
        },
      }),
  )
  // Read-only and public, the same facts as the shop pages: what the page's WebMCP tools search.
  .get("/catalog", ({ query }) => {
    const max = Number(query.max_price);
    const products = searchProducts(query.q ?? "", {
      category: query.category || undefined,
      maxPrice: query.max_price && Number.isFinite(max) ? max : undefined,
    });
    return {
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        price: p.price,
        variants: variantsOf(p).map((v) => ({
          id: v.id,
          colour: v.colour.label,
          size: v.size,
          available: v.available,
        })),
      })),
    };
  })
  .post("/checkouts", ({ request, body }) => {
    try {
      const input = isRecord(body) ? body : {};
      const lines = Array.isArray(input.lines) ? input.lines : [];
      const customer = customerOf(request);
      const checkout = commerce.createCheckout(
        {
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
          applyWelcomeOffer: input.applyWelcomeOffer === true,
        },
        undefined,
        { customer },
      );
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
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      throw error;
    }
  })
  .get("/checkouts/:id", ({ request, params }) => {
    try {
      return checkoutView(commerce.loadCheckout(params.id, "browser"), customerOf(request));
    } catch {
      return refused(404, "not_found");
    }
  })
  .post("/checkouts/:id/session", async ({ request, params }) => {
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    try {
      return await commerce.startShopperSession(
        commerce.loadCheckout(params.id, "browser"),
        customerOf(request),
      );
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      return refused(502, "session_failed");
    }
  })
  // The Pay email modal's sign-in or new account (ADR-020): the open checkout becomes the signed-in
  // shopper's, with the welcome offer when asked for and the account has no order yet.
  .post("/checkouts/:id/claim", ({ request, params, body }) => {
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    const customer = customerOf(request);
    if (!customer) return refused(401, "sign_in_required");
    const input = body === undefined || body === null ? {} : body;
    if (
      !isRecord(input) ||
      Object.keys(input).some((k) => k !== "applyWelcomeOffer") ||
      (input.applyWelcomeOffer !== undefined && typeof input.applyWelcomeOffer !== "boolean")
    )
      return refused(400, "invalid_request");
    try {
      const claimed = commerce.claimCheckout(
        commerce.loadCheckout(params.id, "browser"),
        customer,
        { applyWelcomeOffer: input.applyWelcomeOffer === true },
      );
      trace({
        channel: commerce.channelOf(claimed),
        actor: "shopper",
        method: "POST",
        path: "/api/checkouts/:id/claim",
        status: 200,
        ref: claimed.id,
        detail: { welcomeOffer: claimed.welcomeOffer?.seasonId ?? "none" },
      });
      return {
        ...checkoutView(claimed, customer),
        welcomeOfferApplied: Boolean(claimed.welcomeOffer),
      };
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      throw error;
    }
  })
  // A checkout handed over without an email (an agent shopping as a guest) gets it from the person
  // paying at its link. It fills a gap only: an email already set, or an account's, never changes.
  .post("/checkouts/:id/email", ({ request, params, body }) => {
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    const input = isRecord(body) ? body : {};
    const customer = customerOf(request);
    try {
      const checkout = commerce.loadCheckout(params.id, "browser");
      if (checkout.customerId && checkout.customerId !== customer?.id)
        return refused(404, "not_found");
      if (commerce.buyerOf(checkout)?.email) return refused(409, "email_set");
      const email = typeof input.email === "string" ? input.email.trim() : "";
      if (!email) return refused(400, "invalid_email");
      const updated = commerce.updateCheckout(checkout, { buyer: { ...checkout.buyer, email } });
      trace({
        channel: commerce.channelOf(updated),
        actor: "shopper",
        method: "POST",
        path: "/api/checkouts/:id/email",
        status: 200,
        ref: updated.id,
        detail: { email: "set" },
      });
      return checkoutView(updated, customer);
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      throw error;
    }
  })
  // Standard, express or a pickup point, from the store's own lists: the page and the Ask panel
  // both send it here, the checkout's account or a guest's link holder only.
  .post("/checkouts/:id/delivery", ({ request, params, body }) => {
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    const customer = customerOf(request);
    const delivery = parseDelivery(body);
    if (!delivery) return refused(400, "invalid_delivery");
    try {
      const checkout = commerce.loadCheckout(params.id, "browser");
      if (checkout.customerId && checkout.customerId !== customer?.id)
        return refused(404, "not_found");
      const updated = commerce.setDelivery(checkout, delivery);
      trace({
        channel: commerce.channelOf(updated),
        actor: "shopper",
        method: "POST",
        path: "/api/checkouts/:id/delivery",
        status: 200,
        ref: updated.id,
        detail: { method: delivery.method, place: delivery.placeId },
      });
      return checkoutView(updated, customer);
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      throw error;
    }
  })
  // The shopper's one bag reached a web checkout page: its lines follow, unless a payment holds it.
  .post("/checkouts/:id/lines", ({ request, params, body }) => {
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    const input = isRecord(body) ? body : {};
    const customer = customerOf(request);
    try {
      const checkout = commerce.loadCheckout(params.id, "browser");
      if (
        commerce.channelOf(checkout) !== "web" ||
        (checkout.customerId && checkout.customerId !== customer?.id)
      )
        return refused(404, "not_found");
      const lines = Array.isArray(input.lines)
        ? input.lines.map((l) => ({
            item: { id: isRecord(l) ? l.variantId : undefined },
            quantity: isRecord(l) ? l.quantity : undefined,
          }))
        : undefined;
      if (!lines?.length) return refused(400, "invalid_line_items");
      const updated = commerce.updateCheckout(checkout, { line_items: lines });
      trace({
        channel: "web",
        actor: "shopper",
        method: "POST",
        path: "/api/checkouts/:id/lines",
        status: 200,
        ref: updated.id,
        detail: { lines: updated.lines.length },
      });
      return checkoutView(updated, customer);
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      throw error;
    }
  })
  // Drop-in's beforeSubmit: the checkout is held for this session's payment, or the form stops.
  .post("/checkouts/:id/pay-intent", ({ request, params, body }) => {
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    const input = isRecord(body) ? body : {};
    const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
    try {
      const held = commerce.claimWebPayment(
        params.id,
        sessionId,
        Date.now(),
        customerOf(request)?.id,
      );
      return { held: true, until: held.paying?.until };
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      throw error;
    }
  })
  .post("/checkouts/:id/session-result", async ({ request, params, body }) => {
    const input = isRecord(body) ? body : {};
    try {
      const checkout = await commerce.finishShopperSession(
        commerce.loadCheckout(params.id, "browser"),
        String(input.sessionId ?? ""),
        String(input.sessionResult ?? ""),
      );
      return checkoutView(checkout, customerOf(request));
    } catch (error) {
      if (error instanceof commerce.CommerceError) return refusedBy(error);
      return refused(502, "result_unconfirmed");
    }
  })
  .get("/back-office", ({ request, query }) => {
    if (!backOfficeAllowed(request.headers.get("authorization")))
      return status(401, { error: "Back Office sign-in required" });
    return backOfficeView(
      query.channel === "web" || query.channel === "agent" ? query.channel : undefined,
      query,
    );
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

// The buyer's details show to the checkout's own signed-in customer, or to anyone holding the link
// of a checkout no account holds (a guest's).
export function checkoutView(checkout: commerce.Checkout, viewer?: Customer) {
  const ownsIt = !checkout.customerId || checkout.customerId === viewer?.id;
  const assessment = commerce.assess(checkout, undefined, []);
  const priced = commerce.checkoutPrice(checkout);
  const order = checkout.orderId ? get<commerce.Order>("orders", checkout.orderId) : undefined;
  return {
    id: checkout.id,
    phase: checkout.phase,
    status: assessment.status,
    // A person reads the store's refusals in plain words, never the text written for agents.
    messages: assessment.messages
      .filter((m) => m.code !== "payments_unavailable" && m.code !== "sign_in_required")
      .map((m) => ({ ...m, content: shopperWords(m.code) })),
    agentName: checkout.agentName,
    lines: priced.items.map(({ line, variant, amount }) => ({
      id: line.id,
      variantId: variant.id,
      title: variant.title,
      quantity: line.quantity,
      unitPrice: variant.price,
      amount,
    })),
    // The welcome offer's tote and saving, both from the server's price (ADR-020).
    gift: priced.gift,
    welcomeOffer: checkout.welcomeOffer,
    subtotal: priced.subtotal,
    discount: priced.discount,
    fulfillment: priced.fulfillment,
    total: priced.total,
    delivery: checkout.delivery ?? DEFAULT_DELIVERY,
    buyer: ownsIt ? checkout.buyer : undefined,
    // The page offers the signed-in shopper their own address for a receipt instead of a blank
    // field, and offers sign-in instead when the session has ended.
    signedIn: Boolean(viewer),
    accountEmail: viewer && ownsIt ? viewer.email : undefined,
    // Whether the signed-in owner may still ask for the welcome offer on this checkout.
    welcomeOfferAvailable: Boolean(
      viewer &&
        ownsIt &&
        checkout.phase === "open" &&
        !checkout.welcomeOffer &&
        commerce.isFirstOrderEligible(viewer.id),
    ),
    channel: commerce.channelOf(checkout),
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

export { accountView } from "./accounts/account-api";

// The JSON view keeps its fields; its trace is one page of the Log, with the same filters, and
// every email in it is masked (the Back Office is public without the playground's basic auth).
export function backOfficeView(channel?: commerce.Channel, query: Record<string, unknown> = {}) {
  const keep = (record: Parameters<typeof commerce.channelOf>[0]) =>
    !channel || commerce.channelOf(record) === channel;
  const filters = backOffice.logFilters(query);
  const log = backOffice.tracePage(
    filters,
    backOffice.pageParam(query.page),
    backOffice.perParam(query.per),
  );
  return maskEmails({
    channel: channel ?? "all",
    orders: list<commerce.Order>("orders", 100)
      .filter(keep)
      .map((o) => ({ ...o, channel: commerce.channelOf(o) })),
    payments: list<commerce.PaymentRecord>("payments", 100)
      .filter(keep)
      .map((p) => ({ ...p, channel: commerce.channelOf(p) })),
    checkouts: list<commerce.Checkout>("checkouts", 100)
      .filter(keep)
      .map((c) => ({
        id: c.id,
        phase: c.phase,
        channel: commerce.channelOf(c),
        customerId: c.customerId,
        agentName: c.agentName,
        total: commerce.checkoutPrice(c).total,
        welcomeOffer: c.welcomeOffer?.seasonId,
        attempts: c.attempts,
        orderId: c.orderId,
        createdAt: c.createdAt,
      })),
    trace: log.items,
    page: log.page,
    per: log.per,
    filters,
    trace_total: log.total,
    trace_pages: log.pages,
  });
}

const app = new Elysia()
  .onRequest(({ request }) =>
    request.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS }) : undefined,
  )
  .onAfterHandle(({ request, responseValue }) => {
    const path = new URL(request.url).pathname;
    if (responseValue instanceof Response && !path.startsWith("/api/")) withCors(responseValue);
  })
  // The plugin package (ADR-017): public, the same bytes for everyone on this deployment.
  .get(
    PLUGIN_ZIP_PATH,
    () =>
      new Response(pluginZip(), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="atelier-velune-plugin.zip"',
          "cache-control": "public, max-age=300",
        },
      }),
  )
  .get("/healthz", () => ({
    status: "ok",
    environment: "TEST",
    payments: paymentsConfigured(),
    ucp: UCP_VERSION,
    pap: "1.0",
  }))
  .get("/.well-known/poppy.json", () => withCors(json(200, poppyDocument())))
  .get("/.well-known/ucp", ({ request }) => withCors(published(request, profile())))
  .get("/.well-known/oauth-authorization-server", () =>
    withCors(json(200, oauth.authorizationServerMetadata())),
  )
  .get("/.well-known/oauth-protected-resource", () =>
    withCors(json(200, oauth.protectedResourceMetadata(config().publicOrigin))),
  )
  .get("/.well-known/oauth-protected-resource/mcp", () =>
    withCors(json(200, oauth.protectedResourceMetadata(`${config().publicOrigin}/mcp`))),
  )
  .get("/.well-known/oauth-protected-resource/mcp/code", () =>
    withCors(json(200, oauth.protectedResourceMetadata(`${config().publicOrigin}/mcp/code`))),
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
    const requestId = form.get("request") ?? "";
    const customer = customerOf(request);
    if (!customer) return signInFirst(`/consent/${encodeURIComponent(requestId)}`);
    try {
      const location = oauth.decide({
        requestId,
        customerId: customer.id,
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
    // Every call stores a request, so it shares the limit agents get on UCP and /mcp.
    const limited = agentLimit(request);
    if (limited) return limited;
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
    if (!customerOf(request))
      return signInFirst(typed ? `/device?user_code=${encodeURIComponent(typed)}` : "/device");
    // The rate limit's client address. A caller with many addresses still spreads its guesses;
    // the total limit in verifyUserCode bounds them whatever the addresses.
    const outcome = oauth.verifyUserCode(typed, clientIp(request));
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
  // Each call may fetch the client's documents and checks a signature: the agents' limit too.
  .post("/oauth/token", async ({ request }) => {
    const limited = agentLimit(request);
    if (limited) return limited;
    try {
      const form = await formOf(request);
      const tokens = await oauth.tokenEndpoint(form);
      const audience = oauth.assertionAudienceUsed(form);
      trace({
        channel: "oauth",
        actor: "agent",
        method: "POST",
        path: "/oauth/token",
        status: 200,
        ref: null,
        detail: { scope: tokens.scope, ...(audience ? { audience } : {}) },
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
    const limited = agentLimit(request);
    if (limited) return limited;
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
  .get("/ucp/v1/openapi.json", ({ request }) => published(request, openApi()))
  .get("/ucp/v1/handlers/saved_card.json", ({ request }) => published(request, handlerSchema()))
  .get("/ucp/v1/handlers/network_token.json", ({ request }) =>
    published(request, networkTokenSchema()),
  )
  .all("/ucp/v1/*", ({ request, params }) => handleRest(request, `/${params["*"]}`))
  .all("/mcp", ({ request }) => handleMcp(request))
  .all("/mcp/code", ({ request }) => handleCodeMcp(request))
  .get("/poppy/tasks", ({ request }) => handleTasks(request))
  .post("/poppy/feedback", ({ request }) => handleFeedback(request))
  .use(browserApi)
  .use(accountApi)
  .use(askApi)
  .use(voiceApi)
  .use(consoleApi);

export type App = typeof app;

export const handle = (request: Request) => app.fetch(request);

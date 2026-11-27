// Spec: knowledge/components/adyen-agentic-commerce.md
// The customer's own routes (ADR-015): sign-up, sign-in and sign-out, passkeys, and the account.
// They read the session cookie and nothing else: a bearer token here binds nothing to an account.
import { Elysia } from "elysia";
import * as adyen from "../payments/adyen";
import * as commerce from "../commerce/commerce";
import { config, paymentsConfigured } from "../core/config";
import * as customers from "./customers";
import { findBy } from "../core/db";
import * as oauth from "../oauth/oauth";
import { clientIp, rateLimited } from "../protocol";
import { trace } from "../core/trace";
import { isRecord, json } from "../core/util";
import { maskEmail } from "../../lib/mask";

// Drop-in, card-save and passkey sign-in sessions each open a form or store a challenge; a script
// testing cards would run through them, so each address gets this many a minute.
export const SESSIONS_PER_MINUTE = 20;

export function sessionLimit(request: Request, kind: "payment" | "passkey"): Response | undefined {
  const retry = rateLimited(`${kind}:${clientIp(request)}`, SESSIONS_PER_MINUTE);
  if (!retry) return undefined;
  return json(
    429,
    { error: "rate_limited", message: "Too many attempts; try again in a minute" },
    { "retry-after": String(retry) },
  );
}

// The Pay modal's email check (ADR-020): 15 answers per address per quarter hour, and never faster
// than the floor, so neither a burst nor a stopwatch tells much more than the boolean it returns.
export const EMAIL_CHECKS = 15;
export const EMAIL_CHECK_WINDOW_MS = 15 * 60_000;
export const EMAIL_CHECK_FLOOR_MS = 45;
const CHECKED_EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;

// The proxy already refuses another site; read again here so the route holds on its own.
function fromStorePage(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  return (
    origin === null || origin === config().publicOrigin || origin === new URL(request.url).origin
  );
}

async function checkEmail(request: Request): Promise<Response> {
  const started = performance.now();
  if (!fromStorePage(request) || request.headers.get("x-velune-check") !== "1")
    return json(403, { error: "forbidden", message: "Check header required" });
  // Counted before the body is read, so malformed bodies spend the same allowance.
  const retry = rateLimited(
    `email-check:${clientIp(request)}`,
    EMAIL_CHECKS,
    EMAIL_CHECK_WINDOW_MS,
  );
  if (retry)
    return json(
      429,
      { error: "rate_limited", message: "Too many checks. Try again shortly." },
      { "retry-after": String(retry) },
    );
  const body: unknown = await request.json().catch(() => undefined);
  const raw = isRecord(body) && Object.keys(body).length === 1 ? body.email : undefined;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > 254 || !CHECKED_EMAIL.test(email))
    return json(400, { error: "invalid_email", message: "Enter a valid email address" });
  const exists = customers.hasAccount(email);
  trace({
    channel: "web",
    actor: "shopper",
    method: "POST",
    path: "/api/session/check-email",
    status: 200,
    ref: null,
    detail: { email: maskEmail(email) },
  });
  const wait = EMAIL_CHECK_FLOOR_MS - (performance.now() - started);
  if (wait > 0) await Bun.sleep(wait);
  return json(200, { exists }, { "cache-control": "no-store" });
}

export const customerOf = (request: Request) =>
  customers.customerFromCookies(request.headers.get("cookie"));

const signInRequired = () =>
  json(401, { error: "sign_in_required", message: "Sign in to your account first" });

function customerError(error: unknown): Response {
  if (!(error instanceof customers.CustomerError)) throw error;
  const headers: Record<string, string> = error.retryAfter
    ? { "retry-after": String(error.retryAfter) }
    : {};
  return json(error.status, { error: error.code, message: error.message }, headers);
}

const disconnected = () =>
  json(409, {
    error: "agent_disconnected",
    message: "This agent is disconnected; its limit can no longer change",
  });

const signedIn = (customer: customers.Customer, cookie: string) =>
  json(200, { customer: { email: customer.email, name: customer.name } }, { "set-cookie": cookie });

export async function accountView(customer: customers.Customer, refresh = false) {
  const cards = await commerce.savedCards(customer.id, refresh);
  return {
    customer: { email: customer.email, name: customer.name, createdAt: customer.createdAt },
    shopperReference: customer.id,
    paymentsReady: paymentsConfigured(),
    cards: cards.map(({ storedPaymentMethodId: _hidden, ...card }) => card),
    passkeys: customers.passkeysOf(customer.id).map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
    })),
    agents: oauth.grants(customer.id).map((g) => ({
      id: g.id,
      clientId: g.clientId,
      name: g.clientName,
      scopes: g.scopes,
      // The consent page's words, so the account never shows a shopper a protocol name.
      permissions: g.scopes.map((s) => oauth.SCOPES[s].short),
      spendLimit: g.spendLimit,
      spent: g.spent,
      remaining: Math.max(g.spendLimit - g.spent, 0),
      revoked: g.revoked,
      createdAt: g.createdAt,
      tokenIssuedAt: g.tokenIssuedAt,
      firstUsedAt: g.firstUsedAt,
      lastUsedAt: g.lastUsedAt,
    })),
    firstOrderEligible: commerce.isFirstOrderEligible(customer.id),
    orders: findBy<commerce.Order>("orders", "customerId", customer.id)
      .slice(0, 50)
      .map((o) => ({
        id: o.id,
        total: o.total,
        discount: o.discount,
        gift: o.welcomeOffer?.giftTitle,
        status: o.status,
        channel: commerce.channelOf(o),
        paidBy: o.paidBy,
        agentName: o.agentName,
        createdAt: o.createdAt,
      })),
  };
}

export const accountApi = new Elysia({ prefix: "/api" })
  .post("/customers", async ({ request, body }) => {
    try {
      const { customer, cookie } = await customers.signUp(body, clientIp(request));
      trace({
        channel: "web",
        actor: "shopper",
        method: "POST",
        path: "/api/customers",
        status: 200,
        ref: customer.id,
        detail: {},
      });
      return signedIn(customer, cookie);
    } catch (error) {
      return customerError(error);
    }
  })
  .post("/session/check-email", ({ request }) => checkEmail(request))
  .get("/session", ({ request }) => {
    const customer = customerOf(request);
    return { customer: customer ? { email: customer.email, name: customer.name } : null };
  })
  .post("/session", async ({ request, body }) => {
    try {
      const { customer, cookie } = await customers.signIn(body, clientIp(request));
      return signedIn(customer, cookie);
    } catch (error) {
      return customerError(error);
    }
  })
  .delete("/session", ({ request }) =>
    json(
      200,
      { signedOut: true },
      { "set-cookie": customers.signOut(request.headers.get("cookie")) },
    ),
  )
  .post("/passkeys/register/options", async ({ request, body }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    try {
      // A new passkey can confirm a raise, so a session alone cannot add one: the shopper proves it
      // with the password, or with a passkey already on the account.
      const confirm = isRecord(body) ? body.confirm : undefined;
      await customers.confirmIdentity(customer, confirm, clientIp(request));
      return await customers.registrationOptions(customer);
    } catch (error) {
      return customerError(error);
    }
  })
  .post("/passkeys/register/verify", async ({ request, body }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    try {
      await customers.verifyRegistration(customer, body);
      return await accountView(customer);
    } catch (error) {
      return customerError(error);
    }
  })
  .post("/passkeys/login/options", async ({ request }) => {
    const limited = sessionLimit(request, "passkey");
    if (limited) return limited;
    try {
      return await customers.loginOptions();
    } catch (error) {
      return customerError(error);
    }
  })
  .post("/passkeys/login/verify", async ({ body }) => {
    try {
      const { customer, cookie } = await customers.verifyLogin(body);
      return signedIn(customer, cookie);
    } catch (error) {
      return customerError(error);
    }
  })
  .delete("/passkeys/:id", async ({ request, params }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    if (!customers.removePasskey(customer, params.id))
      return json(404, { error: "not_found", message: "Unknown passkey" });
    return await accountView(customer);
  })
  .get("/account", async ({ request }) => {
    const customer = customerOf(request);
    return customer ? await accountView(customer) : signInRequired();
  })
  .post("/account/card-session", async ({ request }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    const limited = sessionLimit(request, "payment");
    if (limited) return limited;
    try {
      return await commerce.startCardSave(customer);
    } catch {
      return json(502, { error: "The card session could not be created" });
    }
  })
  .post("/account/card-result", async ({ request, body }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    const input = isRecord(body) ? body : {};
    try {
      const before = (await commerce.savedCards(customer.id)).length;
      const result = await commerce.finishCardSave(
        customer,
        String(input.sessionId ?? ""),
        String(input.sessionResult ?? ""),
      );
      let account = await accountView(customer, true);
      if (
        result === "completed" &&
        account.cards.length <= before &&
        process.env.NODE_ENV === "production"
      ) {
        await new Promise((r) => setTimeout(r, 700));
        account = await accountView(customer, true);
      }
      return { result, account };
    } catch {
      return json(502, { error: "Adyen could not confirm the card" });
    }
  })
  .delete("/account/cards/:alias", async ({ request, params }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    const card = (await commerce.savedCards(customer.id, true)).find(
      (c) => c.alias === params.alias,
    );
    if (!card) return json(404, { error: "Unknown card" });
    await adyen.forgetCard(card.storedPaymentMethodId, customer.id);
    commerce.forgetCardCache(customer.id);
    trace({
      channel: "web",
      actor: "shopper",
      method: "DELETE",
      path: "/storedPaymentMethods",
      status: 200,
      ref: params.alias,
      detail: { brand: card.brand, lastFour: card.lastFour },
    });
    return await accountView(customer, true);
  })
  .post("/account/confirm/options", async ({ request }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    const limited = sessionLimit(request, "passkey");
    if (limited) return limited;
    try {
      return await customers.confirmOptions(customer);
    } catch (error) {
      return customerError(error);
    }
  })
  .post("/account/grants/:id", async ({ request, params, body }) => {
    const customer = customerOf(request);
    if (!customer) return signInRequired();
    const input = isRecord(body) ? body : {};
    const spendLimit = typeof input.spendLimit === "number" ? input.spendLimit : undefined;
    const current = oauth.grants(customer.id).find((g) => g.id === params.id);
    if (!current) return json(404, { error: "Unknown agent" });
    if (spendLimit !== undefined && current.revoked) return disconnected();
    // Only a higher limit lets an agent spend more; lowering it or disconnecting needs no proof.
    let confirmedBy: string | undefined;
    if (spendLimit !== undefined && oauth.limitOf(spendLimit) > current.spendLimit) {
      try {
        confirmedBy = await customers.confirmIdentity(customer, input.confirm, clientIp(request));
      } catch (error) {
        return customerError(error);
      }
    }
    // Applied after the await, on the grant as it is now: a disconnect meanwhile wins.
    const grant = oauth.updateGrant(
      params.id,
      { revoked: input.revoked === true ? true : undefined, spendLimit },
      customer.id,
    );
    if (!grant) return json(404, { error: "Unknown agent" });
    if (grant === "revoked") return disconnected();
    trace({
      channel: "web",
      actor: "shopper",
      method: "POST",
      path: "/account/grants",
      status: 200,
      ref: grant.id,
      detail: {
        revoked: grant.revoked,
        spendLimit: grant.spendLimit,
        ...(confirmedBy ? { confirmedBy } : {}),
      },
    });
    return await accountView(customer);
  });

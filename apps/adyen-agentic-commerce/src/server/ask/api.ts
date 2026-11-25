// Spec: knowledge/components/ask-agent.md
// The shopper's Ask routes (spec Inputs and Outputs): the session, a message answered as a stream
// of stage events, connecting the account, and taps in a widget. Keys, models, scores, verdicts
// and costs never leave here; the customer comes from the store's session cookie, never a body.
import { Elysia } from "elysia";
import { maskEmail } from "../../lib/mask";
import { customerOf } from "../accounts/account-api";
import type { Customer } from "../accounts/customers";
import * as commerce from "../commerce/commerce";
import { config } from "../core/config";
import { trace } from "../core/trace";
import { isRecord, json } from "../core/util";
import { BAG, CAROUSEL, widgetHtml } from "../mcp/widgets";
import { OAuthError } from "../oauth/oauth";
import { clientIp, rateLimited } from "../protocol";
import { AGENT_VERSION, callStoreTool, payRefusal } from "./agent";
import { askConfig } from "./config";
import { type ContextFailure, costToday, modeFor } from "./context";
import { disconnect, houseToken, pollConnect, startConnect } from "./house";
import { newSessions } from "./limits";
import { mergePrices, pricesIn } from "./output";
import type { PipelineEvent } from "./pipeline";
import {
  type AskSession,
  appendMessage,
  clearedSessionCookie,
  type EndReason,
  endSession,
  isRegular,
  mergeCheckouts,
  resolveSession,
  save,
  sessionCookie,
  startSession,
  tokenFromCookies,
  transcript,
} from "./sessions";
import { effectiveSettings, type Settings } from "./settings";
import { admitTurn, answerTurn } from "./turn";
import { endCall } from "./voice";

const MAX_BODY_BYTES = 16_000;
const WIDGET_CALLS_PER_MINUTE = 60;
const EMAIL_CALLS_PER_MINUTE = 10;
// The shape the store accepts in buyer.email (commerce/pricing.ts parseBuyer).
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL = 254;

// What a widget in the panel may ask the store for (spec invariant 15).
export const WIDGET_TOOLS = new Set([
  "search_catalog",
  "get_product",
  "lookup_catalog",
  "create_cart",
  "update_cart",
  "get_cart",
  "create_checkout",
  "update_checkout",
  "get_checkout",
  "complete_checkout",
]);

// The panel hosts a widget in a sandboxed srcdoc frame (opaque origin, scripts only). This policy
// adds what the sandbox does not say: no connection at all, images from the store only.
export function panelWidgetHtml(uri: string): string | undefined {
  if (uri !== CAROUSEL && uri !== BAG) return undefined;
  const origin = config().publicOrigin;
  const policy = [
    "default-src 'none'",
    `img-src ${origin} data:`,
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return widgetHtml(uri).replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  );
}

export const problem = (
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) => json(status, { error, message, ...extra }, headers);

export const forbidden = () =>
  problem(403, "forbidden", "This request must come from the store's page.");
const disabled = () => problem(503, "ask_disabled", "The assistant is not available right now.");

// A state-changing call must come from the store's own page: the custom header forces a CORS
// preflight no other site passes, and a browser's Sec-Fetch-Site must say same-origin.
export function foreign(request: Request): boolean {
  if (request.headers.get("x-ask") !== "1") return true;
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

export async function bodyOf(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type Here = {
  settings: Settings;
  available: boolean;
  customer?: Customer;
  token?: string;
  session?: AskSession;
  ended?: EndReason;
};

// The browser's session after the identity and clock rules, with what the server knows now.
export function here(request: Request): Here {
  const ask = askConfig();
  const settings = effectiveSettings(ask);
  const customer = customerOf(request);
  const token = tokenFromCookies(request.headers.get("cookie"));
  const resolved = resolveSession(token, customer, settings.limits);
  let session = resolved.session;
  if (resolved.ended && session) void disconnect(session.id);
  // A restart forgets the house tokens: the session then stops saying it is connected.
  if (session?.state === "active" && session.connected && !houseToken(session.id))
    session = save({ ...session, connected: undefined });
  return {
    settings,
    available: Boolean(ask.enabled && settings.answer && settings.guard),
    customer,
    token,
    session,
    ended: resolved.ended,
  };
}

export const liveSession = (h: Here) =>
  h.session && h.session.state === "active" && !h.ended ? h.session : undefined;

export const shownMode = (session: AskSession, customer: Customer | undefined) =>
  modeFor(session.score, isRegular(customer)) === "normal" ? "normal" : "strict";

// Voice is offered on an OpenAI conversation in normal mode, with the switch on and OpenAI's key
// set (spec invariant 14).
export const voiceOffered = (h: Here, live: AskSession) =>
  h.available &&
  h.settings.voiceEnabled &&
  askConfig().keys.openai &&
  live.answer.model.startsWith("openai/") &&
  shownMode(live, h.customer) === "normal";

// What the panel shows (spec Outputs): never a score, a verdict, a model, a cost or a key.
export function sessionView(h: Here) {
  const live = liveSession(h);
  const voice = Boolean(live && voiceOffered(h, live));
  return {
    available: h.available,
    state: h.session?.state ?? "none",
    reason: h.ended ?? h.session?.endReason,
    endsAt: live?.endsAt,
    mode: live ? shownMode(live, h.customer) : undefined,
    signedIn: Boolean(h.customer),
    // Masked: the receipt block names the address without the page ever holding it whole.
    accountEmail: h.customer ? maskEmail(h.customer.email) : undefined,
    connected: Boolean(live && houseToken(live.id)),
    voice: { available: voice, unlocked: Boolean(live?.voice.unlocked) },
    messages: live
      ? transcript(live.id).map((m) => ({
          role: m.role,
          text: m.text,
          widgets: m.widgets ?? [],
          at: m.at,
        }))
      : [],
  };
}

// A new session for this browser, ending the current one.
function begin(request: Request, h: Here): { session: AskSession; cookie: string } | Response {
  const { answer: model, guard, limits } = h.settings;
  if (!h.available || !model || !guard) return disabled();
  if (costToday() >= limits.dailyBudgetUsd)
    return problem(
      503,
      "budget_exhausted",
      "The assistant has used today's budget. Please come back tomorrow.",
    );
  const address = clientIp(request);
  const retry = newSessions.hit(`ask:${address}`);
  if (retry)
    return problem(
      429,
      "rate_limited",
      "Too many new conversations. Please try again later.",
      {},
      {
        "retry-after": String(retry),
      },
    );
  if (h.session) {
    void disconnect(h.session.id);
    endCall(h.session.id, "new_session");
  }
  const { token, session } = startSession({
    customer: h.customer,
    address,
    limits,
    answer: model,
    guard,
    agentVersion: AGENT_VERSION,
    previousToken: h.token,
  });
  return { session, cookie: sessionCookie(token, limits.sessionMinutes * 60) };
}

function endedAnswer(session: AskSession, reason: EndReason) {
  void disconnect(session.id);
  if (reason === "locked" || session.state === "locked")
    return problem(423, "session_locked", "This conversation is closed.");
  return problem(409, "session_ended", "This conversation has ended.", { reason });
}

function contextFailure(session: AskSession, failure: ContextFailure): Response {
  if (failure.kind === "end") return endedAnswer(session, failure.reason);
  if (failure.kind === "budget_exhausted")
    return problem(
      503,
      "budget_exhausted",
      "The assistant has used today's budget. Please come back tomorrow.",
    );
  return problem(
    429,
    "rate_limited",
    "Please slow down a little.",
    {},
    {
      "retry-after": String(failure.retryAfter),
    },
  );
}

// What a stream event shows the shopper: a stage's progress, not its verdict, and no score.
function shown(event: PipelineEvent | { type: "error"; error: string }) {
  if (event.type === "stage") return { stage: event.stage };
  if (event.type === "final")
    return { text: event.text, widgets: event.widgets, mode: event.mode, endsAt: event.endsAt };
  return event;
}

function eventStream(run: (emit: (event: PipelineEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: PipelineEvent | { type: "error"; error: string }) => {
        if (!open) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(shown(event))}\n\n`),
          );
        } catch {
          // The shopper closed the panel; the answer still settles the session.
          open = false;
        }
      };
      let finished = false;
      try {
        await run((event) => {
          if (event.type === "final") finished = true;
          send(event);
        });
      } catch {
        // answer() settles every failure itself; reaching here is a bug, still answered.
      }
      if (!finished) send({ type: "error", error: "agent_failed" });
      if (open)
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
    },
  });
}

const STREAM_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
};

export const askApi = new Elysia({ prefix: "/api/ask" })
  .get("/session", ({ request }) => json(200, sessionView(here(request))))
  // JSON, never text/html: opened directly, the widget must not run on the store's own origin.
  .get("/widget-frame", ({ request }) => {
    const uri = new URL(request.url).searchParams.get("uri") ?? "";
    const html = panelWidgetHtml(uri);
    if (!html) return problem(400, "invalid_request", "Unknown widget.");
    return json(200, { uri, html, storeOrigin: config().publicOrigin });
  })
  .post("/session", ({ request }) => {
    if (foreign(request)) return forbidden();
    const h = here(request);
    const started = begin(request, h);
    if (started instanceof Response) return started;
    return json(200, sessionView({ ...h, session: started.session, ended: undefined }), {
      "set-cookie": started.cookie,
    });
  })
  .post("/session/end", ({ request }) => {
    if (foreign(request)) return forbidden();
    const h = here(request);
    const live = liveSession(h);
    if (live) {
      endSession(live, "ended_by_shopper");
      void disconnect(live.id);
      endCall(live.id, "ended_by_shopper");
    }
    return json(200, { state: "ended" }, { "set-cookie": clearedSessionCookie() });
  })
  .post("/messages", async ({ request }) => {
    if (foreign(request)) return forbidden();
    const body = await bodyOf(request);
    if (!body) return problem(400, "invalid_request", "Send JSON with a text field.");
    let h = here(request);
    let cookie: string | undefined;
    // The first message of a browser starts its session.
    if (!h.session) {
      const started = begin(request, h);
      if (started instanceof Response) return started;
      h = { ...h, session: started.session };
      cookie = started.cookie;
    }
    const session = h.session;
    if (!session) return disabled();
    if (h.ended || session.state !== "active")
      return endedAnswer(session, h.ended ?? session.endReason ?? "time");
    if (!h.available) return disabled();
    const turn = {
      session,
      settings: h.settings,
      regular: isRegular(h.customer),
      address: clientIp(request),
    };
    const admission = admitTurn(turn, body.text, body.page, "text", body.bag);
    if (admission.kind === "busy")
      return problem(409, "session_busy", "The assistant is still answering your last message.");
    if (admission.kind === "failed") return contextFailure(session, admission.failure);
    const stream = eventStream(async (emit) => {
      for (const event of admission.events) emit(event);
      if (admission.kind !== "admitted") return;
      await answerTurn(admission, turn, emit);
    });
    return new Response(stream, {
      headers: cookie ? { ...STREAM_HEADERS, "set-cookie": cookie } : STREAM_HEADERS,
    });
  })
  .post("/connect", async ({ request }) => {
    if (foreign(request)) return forbidden();
    const h = here(request);
    if (!h.customer) return problem(401, "not_signed_in", "Sign in to connect your account.");
    const live = liveSession(h);
    if (!live)
      return problem(409, "session_ended", "This conversation has ended.", { reason: h.ended });
    if (shownMode(live, h.customer) !== "normal")
      return problem(403, "strict_mode", "Connecting is paused for this conversation.");
    try {
      return json(200, await startConnect(live.id));
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      return problem(error.status, error.code, error.message);
    }
  })
  .get("/connect", async ({ request }) => {
    const h = here(request);
    if (!h.customer) return problem(401, "not_signed_in", "Sign in to connect your account.");
    const live = liveSession(h);
    if (!live)
      return problem(409, "session_ended", "This conversation has ended.", { reason: h.ended });
    const state = await pollConnect(live.id, h.customer.id);
    if (state === "connected" && !live.connected) {
      const now = Date.now();
      appendMessage(save({ ...live, connected: { at: now } }), {
        role: "note",
        text: "Account connected",
        at: now,
      });
    }
    return json(200, { state });
  })
  .post("/widget", async ({ request }) => {
    if (foreign(request)) return forbidden();
    const body = await bodyOf(request);
    const name = typeof body?.name === "string" ? body.name : undefined;
    if (!body || !name || (body.arguments !== undefined && !isRecord(body.arguments)))
      return problem(400, "invalid_request", "Send JSON with a tool name and its arguments.");
    const h = here(request);
    const live = liveSession(h);
    if (!live)
      return problem(409, "session_ended", "This conversation has ended.", { reason: h.ended });
    const args = isRecord(body.arguments) ? body.arguments : {};
    const mode = shownMode(live, h.customer);
    const connected = Boolean(houseToken(live.id));
    const refusal = !WIDGET_TOOLS.has(name)
      ? "This action is not available in the assistant."
      : name === "complete_checkout" && (!connected || mode !== "normal")
        ? "Paying here needs a connected account; use the checkout link instead."
        : payRefusal(name, args, { mode, widgets: [], prices: [], calls: [] }, connected);
    if (refusal) return problem(403, "widget_tool_refused", refusal);
    const retry = rateLimited(`ask-widget:${clientIp(request)}`, WIDGET_CALLS_PER_MINUTE);
    if (retry)
      return problem(
        429,
        "rate_limited",
        "Please slow down a little.",
        {},
        {
          "retry-after": String(retry),
        },
      );
    const call = await callStoreTool(live.id, name, args);
    const now = Date.now();
    const kept = save({
      ...live,
      prices: call.result
        ? mergePrices(live.prices, pricesIn(call.result.structuredContent))
        : live.prices,
      checkouts: call.result
        ? mergeCheckouts(live.checkouts, [call.result.structuredContent])
        : live.checkouts,
      lastAt: now,
    });
    appendMessage(kept, { role: "note", text: `Widget: ${name}`, via: "widget", at: now });
    if (!call.result)
      return problem(409, "store_refused", call.error ?? "The store refused this action.");
    return json(200, { result: call.result });
  })
  // The receipt email (spec invariant 19): typed in the panel's own block, or the account's read
  // here, it reaches the store without passing a model, the transcript or the widget's data.
  .post("/checkout-email", async ({ request }) => {
    if (foreign(request)) return forbidden();
    const body = await bodyOf(request);
    const checkoutId = typeof body?.checkoutId === "string" ? body.checkoutId : undefined;
    if (!body || !checkoutId)
      return problem(400, "invalid_request", "Send JSON with a checkout id and an email.");
    const h = here(request);
    const live = liveSession(h);
    if (!live)
      return problem(409, "session_ended", "This conversation has ended.", { reason: h.ended });
    const retry = rateLimited(`ask-email:${clientIp(request)}`, EMAIL_CALLS_PER_MINUTE);
    if (retry)
      return problem(
        429,
        "rate_limited",
        "Please slow down a little.",
        {},
        { "retry-after": String(retry) },
      );
    const unknown = () =>
      problem(404, "checkout_unknown", "This checkout is not part of this conversation.");
    if (!live.checkouts?.includes(checkoutId)) return unknown();
    let email: string;
    if (body.account === true) {
      if (!h.customer) return problem(401, "not_signed_in", "Sign in to use your account's email.");
      email = h.customer.email;
    } else {
      email = typeof body.email === "string" ? body.email.trim() : "";
      if (email.length > MAX_EMAIL || !EMAIL.test(email))
        return problem(400, "invalid_email", "Enter a valid email address.");
    }
    try {
      const checkout = commerce.loadCheckout(checkoutId, "browser");
      if (checkout.customerId && checkout.customerId !== h.customer?.id) return unknown();
      // Fills a gap only: an email already set, or an account's, never changes.
      if (checkout.phase !== "open" || commerce.buyerOf(checkout)?.email)
        return problem(409, "store_refused", "This checkout already has an email.");
      const updated = commerce.updateCheckout(checkout, { buyer: { ...checkout.buyer, email } });
      trace({
        channel: commerce.channelOf(updated),
        actor: "shopper",
        method: "POST",
        path: "/api/ask/checkout-email",
        status: 200,
        ref: updated.id,
        detail: { email: "set" },
      });
    } catch (error) {
      if (!(error instanceof commerce.CommerceError)) throw error;
      if (error.status === 404) return unknown();
      return problem(409, "store_refused", "The store could not take this email.");
    }
    const now = Date.now();
    appendMessage(save({ ...live, lastAt: now }), {
      role: "note",
      text: "Receipt email set",
      at: now,
    });
    const call = await callStoreTool(live.id, "get_checkout", { id: checkoutId });
    if (!call.result)
      return problem(409, "store_refused", call.error ?? "The store refused this action.");
    return json(200, { result: call.result });
  });

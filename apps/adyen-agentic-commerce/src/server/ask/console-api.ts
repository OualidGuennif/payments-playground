// Spec: knowledge/components/ask-agent.md
// The console's routes (spec Inputs, invariant 13). Without a CONSOLE_PASSWORD of 16 characters or
// more none of them exists (404). Every POST needs the store's own Origin and X-Console: 1; every
// route but sign-in needs the av_console cookie.
import { Elysia } from "elysia";
import { config } from "../core/config";
import { isRecord, json } from "../core/util";
import { clientIp } from "../protocol";
import { askConfig, EFFORTS } from "./config";
import {
  closeConsoleSession,
  closeSession,
  consoleCookie,
  consoleSignedIn,
  modelCatalog,
  openConsoleSession,
  overview,
  passwordMatches,
  playground,
  redTeam,
  sessionDetail,
  sessionList,
} from "./console";
import { consoleFailures } from "./limits";
import { auditLines, describeSettings, SettingsError, saveSettings } from "./settings";

const MAX_BODY_BYTES = 16_000;
const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  json(status, body, { ...NOINDEX, ...headers });
const notFound = () => new Response("Not found", { status: 404, headers: NOINDEX });
const forbidden = () =>
  reply(403, { error: "forbidden", message: "Sign in to the console from its own page." });

// Why a request may not go on, or nothing when it may.
function refused(
  request: Request,
  opts: { post: boolean; signedIn: boolean },
): Response | undefined {
  if (!askConfig().consolePassword) return notFound();
  if (
    opts.post &&
    (request.headers.get("x-console") !== "1" ||
      request.headers.get("origin") !== config().publicOrigin)
  )
    return forbidden();
  if (opts.signedIn && !consoleSignedIn(request.headers.get("cookie"))) return forbidden();
  return undefined;
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return undefined;
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The settings form: providers with a key, the catalogue, the efforts and the audit log.
const settingsView = (ask: ReturnType<typeof askConfig>) => ({
  ...describeSettings(ask),
  efforts: EFFORTS,
  models: modelCatalog(),
  audit: auditLines(50),
});

const invalid = () => reply(400, { error: "invalid_request", message: "Send a JSON object." });

export const consoleApi = new Elysia({ prefix: "/api/console" })
  .post("/login", async ({ request }) => {
    const stop = refused(request, { post: true, signedIn: false });
    if (stop) return stop;
    const expected = askConfig().consolePassword ?? "";
    const key = `console:${clientIp(request)}`;
    const wait = consoleFailures.blocked(key);
    if (wait)
      return reply(
        429,
        { error: "rate_limited", message: "Too many tries." },
        { "retry-after": String(wait) },
      );
    const body = await bodyOf(request);
    const typed = typeof body?.password === "string" ? body.password : "";
    if (!passwordMatches(typed, expected)) {
      consoleFailures.hit(key);
      return reply(401, { error: "invalid_password", message: "Wrong password." });
    }
    const { cookie } = openConsoleSession();
    return reply(200, { signedIn: true }, { "set-cookie": cookie });
  })
  .post("/logout", ({ request }) => {
    const stop = refused(request, { post: true, signedIn: false });
    if (stop) return stop;
    closeConsoleSession(request.headers.get("cookie"));
    return reply(200, { signedIn: false }, { "set-cookie": consoleCookie("", 0) });
  })
  // Whether this browser holds a console sign-in: the page asks before it draws the form, so a
  // visit before signing in leaves no refused call in the browser's console.
  .get("/status", ({ request }) => {
    const stop = refused(request, { post: false, signedIn: false });
    if (stop) return stop;
    return reply(200, { signedIn: consoleSignedIn(request.headers.get("cookie")) });
  })
  .get(
    "/overview",
    ({ request }) =>
      refused(request, { post: false, signedIn: true }) ?? reply(200, overview(askConfig())),
  )
  .get("/sessions", ({ request, query }) => {
    const stop = refused(request, { post: false, signedIn: true });
    if (stop) return stop;
    const state =
      typeof query.state === "string" && /^(active|ended|locked)$/.test(query.state)
        ? query.state
        : undefined;
    return reply(200, { sessions: sessionList(state) });
  })
  .get("/sessions/:id", ({ request, params }) => {
    const stop = refused(request, { post: false, signedIn: true });
    if (stop) return stop;
    const detail = sessionDetail(params.id);
    return detail
      ? reply(200, detail)
      : reply(404, { error: "not_found", message: "No such session." });
  })
  .post("/sessions/:id/:action", ({ request, params }) => {
    const stop = refused(request, { post: true, signedIn: true });
    if (stop) return stop;
    if (params.action !== "end" && params.action !== "lock") return notFound();
    const closed = closeSession(params.id, params.action);
    return closed
      ? reply(200, closed)
      : reply(404, { error: "not_found", message: "No such session." });
  })
  .get("/settings", ({ request }) => {
    const stop = refused(request, { post: false, signedIn: true });
    if (stop) return stop;
    const ask = askConfig();
    return reply(200, settingsView(ask));
  })
  .post("/settings", async ({ request }) => {
    const stop = refused(request, { post: true, signedIn: true });
    if (stop) return stop;
    const body = await bodyOf(request);
    if (!body) return invalid();
    try {
      saveSettings(askConfig(), body);
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      return reply(400, { error: "invalid_setting", field: error.field, message: error.message });
    }
    const ask = askConfig();
    return reply(200, settingsView(ask));
  })
  .post("/playground", async ({ request }) => {
    const stop = refused(request, { post: true, signedIn: true });
    if (stop) return stop;
    const body = await bodyOf(request);
    if (!body) return invalid();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
    const result = await playground(askConfig(), body.text, sessionId);
    return result
      ? reply(200, result)
      : reply(503, { error: "ask_disabled", message: "No answer or guard model has a key." });
  })
  .post("/redteam", async ({ request }) => {
    const stop = refused(request, { post: true, signedIn: true });
    if (stop) return stop;
    const result = await redTeam(askConfig());
    return result
      ? reply(200, result)
      : reply(503, { error: "ask_disabled", message: "No guard model has a key." });
  });

// Spec: knowledge/components/platform-package.md
import { Elysia, status } from "elysia";
import type { AppId, ProfileSecrets } from "./types.ts";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import { Repository } from "./storage.ts";
import { ProfileStore } from "./profiles.ts";
import {
  applySecurityHeaders,
  basicAuthChallenge,
  CookieJar,
  csrfRejection,
  ensureSession,
  rateLimiter,
  readPreferredProfile,
  writePreferredProfile,
} from "./security.ts";
import { sanitize } from "./sanitize.ts";

export interface PlatformContext {
  appId: AppId;
  config: ServerConfig;
  repository: Repository;
  profiles: ProfileStore;
}

// One jar per request, shared by the security pass in serveSecurely and the route handlers, so a
// cookie a handler sets reaches the response the same way the session cookies do.
const jars = new WeakMap<Request, CookieJar>();

export function cookiesOf(request: Request): CookieJar {
  let jar = jars.get(request);
  if (!jar) {
    jar = new CookieJar(request);
    jars.set(request, jar);
  }
  return jar;
}

type RequestBody = Record<string, unknown> | undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/** The shared routes; each app chains its own onto the returned instance. */
export function createPlatformApi(context: PlatformContext) {
  const { appId } = context;
  // The context is read inside each handler: it opens its database on first use, not when an
  // app's API module loads, so `next build` workers never open the file at the same time.
  return new Elysia()
    .onError(({ code, error, request }) => {
      if (code === "NOT_FOUND") return Response.json({ error: "Not found." }, { status: 404 });
      if (code === "PARSE") return Response.json({ error: "Invalid JSON body." }, { status: 400 });
      const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
      const message = errorMessage(error);
      context.repository.audit({
        appId,
        correlationId,
        action: `${request.method} ${new URL(request.url).pathname}`,
        outcome: "error",
        payload: { message },
      });
      return Response.json(
        { error: message || "Unexpected server error.", correlationId },
        { status: 500 },
      );
    })
    .get("/api/health", () => ({
      status: "ok",
      app: appId,
      environment: "TEST",
      versions: {
        next: "16.4.3",
        elysia: "1.4.30",
        adyenWeb: "6.48.1",
        checkoutApi: "v72",
        adyenNode: "32.3.0",
      },
      now: new Date().toISOString(),
    }))
    .get("/healthz", () => ({ status: "ok", app: appId }))
    .get("/api/bootstrap", async ({ request }) => {
      const jar = cookiesOf(request);
      await ensureSession(request, jar, context.config.signingSecret);
      const available = await context.profiles.listPublic();
      const preferred = await readPreferredProfile(jar, appId, context.config.signingSecret);
      const selected = available.find((profile) => profile.id === preferred) ?? available[0];
      const secrets = await context.profiles.getSecrets(selected.id);
      return {
        appId,
        environment: "TEST" as const,
        warning:
          "TEST ENVIRONMENT ONLY, Do not enter or upload production credentials. All variables, endpoints and payment flows are exclusively for Adyen TEST.",
        profile: selected,
        profiles: available,
        // Adyen client keys are publishable by design and are required by Web
        // Components. API/HMAC/basic-auth secrets never leave the server.
        clientKey: secrets?.clientKey?.startsWith("test_") ? secrets.clientKey : null,
        publicOrigin: context.config.publicOrigin,
        webhookUrl: `${context.config.publicOrigin}/webhook`,
        // Only whether a key exists, so settings can say if webhooks will verify.
        webhookHmacConfigured: Boolean(secrets?.hmacKey),
      };
    })
    .get("/api/profiles", async () => ({ profiles: await context.profiles.listPublic() }))
    .post("/api/profiles", async ({ body }) => {
      const input = body as RequestBody;
      const label = typeof input?.label === "string" ? input.label : "";
      const secrets = (input?.secrets ?? {}) as ProfileSecrets;
      const profile = await context.profiles.save(label, secrets);
      context.repository.audit({
        appId,
        correlationId: profile.id,
        action: "profile.create",
        outcome: "success",
        payload: { profileId: profile.id, label: profile.label },
      });
      return status(201, { profile });
    })
    .post("/api/profiles/preferred", async ({ body, request }) => {
      const input = body as RequestBody;
      const profileId = typeof input?.profileId === "string" ? input.profileId : undefined;
      const profile = profileId ? await context.profiles.getPublic(profileId) : undefined;
      if (!profile) return status(404, { error: "Unknown profile." });
      await writePreferredProfile(
        request,
        cookiesOf(request),
        appId,
        profile.id,
        context.config.signingSecret,
      );
      context.repository.audit({
        appId,
        correlationId: profile.id,
        action: "profile.preferred",
        outcome: "success",
        payload: { profileId: profile.id },
      });
      return { profile };
    })
    .delete("/api/profiles/:id", ({ params }) => {
      const id = params.id;
      const deleted = context.profiles.delete(id);
      context.repository.audit({
        appId,
        correlationId: id,
        action: "profile.delete",
        outcome: deleted ? "success" : "not_found",
        payload: { profileId: id },
      });
      return deleted ? { deleted: true } : status(404, { error: "Profile not found." });
    })
    .post("/api/callbacks", ({ body }) => {
      const input = body as RequestBody;
      const correlationId = typeof input?.correlationId === "string" ? input.correlationId : "";
      const name = typeof input?.name === "string" ? input.name : "";
      if (!correlationId || !name) {
        return status(400, { error: "correlationId and name are required." });
      }
      const id = context.repository.recordCallback({
        appId,
        correlationId,
        name,
        payload: sanitize(input?.payload),
        occurredAt: typeof input?.occurredAt === "string" ? input.occurredAt : undefined,
      });
      return status(201, { id });
    })
    .get("/api/timeline/:correlationId", ({ params }) => ({
      entries: context.repository.timeline(params.correlationId),
    }));
}

export function createPlatformContext(appId: AppId): PlatformContext {
  let config: ServerConfig | undefined;
  let repository: Repository | undefined;
  let profiles: ProfileStore | undefined;
  const context: PlatformContext = {
    appId,
    get config() {
      config ??= loadServerConfig(appId);
      return config;
    },
    get repository() {
      repository ??= new Repository(context.config.databasePath);
      return repository;
    },
    get profiles() {
      profiles ??= new ProfileStore({
        database: context.repository.database,
        databasePath: context.config.databasePath,
        appId,
        defaultProfile: context.config.defaultProfile,
        defaultSecrets: context.config.defaultSecrets,
      });
      return profiles;
    },
  };
  return context;
}

interface Handles {
  handle(request: Request): Promise<Response> | Response;
}

/**
 * The fetch handler every Next route file exports: Basic Auth, the rate limit
 * and, on /api/*, CSRF and the session run before Elysia routes the request;
 * the cookies issued and the security headers are added to whatever it answers.
 */
export function serveSecurely(
  app: Handles,
  context: { readonly config: { signingSecret: string; publicOrigin: string } },
): (request: Request) => Promise<Response> {
  const limit = rateLimiter();
  return async (request) => {
    const early = basicAuthChallenge(request) ?? limit(request);
    if (early) return finish(early, []);
    const jar = cookiesOf(request);
    if (new URL(request.url).pathname.startsWith("/api/")) {
      const rejected = csrfRejection(request, jar, context.config.publicOrigin);
      if (rejected) return finish(rejected, []);
      await ensureSession(request, jar, context.config.signingSecret);
    }
    return finish(await app.handle(request), jar.issued);
  };
}

function finish(response: Response, cookies: string[]): Response {
  // A copy, because a Response another layer built may carry immutable headers.
  const answer = new Response(response.body, response);
  for (const cookie of cookies) answer.headers.append("Set-Cookie", cookie);
  applySecurityHeaders(answer.headers);
  return answer;
}

export async function selectedSecrets(
  context: PlatformContext,
  request: Request,
): Promise<{ id: string; secrets: ProfileSecrets }> {
  let id = "default";
  // The bootstrap response resolves the signed HttpOnly preference cookie.
  // Subsequent same-origin calls repeat that non-secret profile id explicitly.
  const requested = request.headers.get("x-profile-id");
  if (requested && (await context.profiles.getPublic(requested))) id = requested;
  const secrets = await context.profiles.getSecrets(id);
  if (!secrets) throw new Error("Selected profile is unavailable.");
  return { id, secrets };
}

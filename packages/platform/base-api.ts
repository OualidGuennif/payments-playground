import { Hono } from "hono";
import type { AppId, ProfileSecrets } from "./types.ts";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import { Repository } from "./storage.ts";
import { ProfileStore } from "./profiles.ts";
import {
  csrfProtection,
  ensureSession,
  optionalBasicAuth,
  rateLimit,
  readPreferredProfile,
  securityHeaders,
  writePreferredProfile,
} from "./security.ts";
import { sanitize } from "./sanitize.ts";

export interface PlatformContext {
  appId: AppId;
  config: ServerConfig;
  repository: Repository;
  profiles: ProfileStore;
  api: Hono;
}

export function createPlatformContext(appId: AppId): PlatformContext {
  const config = loadServerConfig(appId);
  const repository = new Repository(config.databasePath);
  const profiles = new ProfileStore({
    database: repository.database,
    databasePath: config.databasePath,
    appId,
    defaultProfile: config.defaultProfile,
    defaultSecrets: config.defaultSecrets,
  });
  const api = new Hono();
  api.use("*", securityHeaders());
  api.use("*", optionalBasicAuth());
  api.use("*", rateLimit());
  api.use("/api/*", csrfProtection(config.signingSecret, config.publicOrigin));

  api.onError((error, c) => {
    const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
    repository.audit({
      appId,
      correlationId,
      action: `${c.req.method} ${new URL(c.req.url).pathname}`,
      outcome: "error",
      payload: { message: error.message },
    });
    return c.json(
      {
        error: error.message || "Unexpected server error.",
        correlationId,
      },
      500,
    );
  });

  api.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      app: appId,
      environment: "TEST",
      versions: {
        fresh: "2.3.3",
        hono: "4.12.31",
        adyenWeb: "6.47.0",
        checkoutApi: "v72",
        adyenNode: "32.0.0",
      },
      now: new Date().toISOString(),
    });
  });
  api.get("/healthz", (c) => c.json({ status: "ok", app: appId }));

  api.get("/api/bootstrap", async (c) => {
    await ensureSession(c, config.signingSecret);
    const available = await profiles.listPublic();
    const preferred = await readPreferredProfile(c, appId, config.signingSecret);
    const selected = available.find((profile) => profile.id === preferred) ?? available[0];
    const secrets = await profiles.getSecrets(selected.id);
    return c.json({
      appId,
      environment: "TEST",
      warning:
        "TEST ENVIRONMENT ONLY, Do not enter or upload production credentials. All variables, endpoints and payment flows are exclusively for Adyen TEST.",
      profile: selected,
      profiles: available,
      // Adyen client keys are publishable by design and are required by Web
      // Components. API/HMAC/bearer/basic-auth secrets never leave the server.
      clientKey: secrets?.clientKey?.startsWith("test_") ? secrets.clientKey : null,
      publicOrigin: config.publicOrigin,
      webhookUrl: `${config.publicOrigin}/webhook`,
      // Only whether a key exists, so settings can say if webhooks will verify.
      webhookHmacConfigured: Boolean(secrets?.hmacKey),
      agentic: {
        realEnabled: config.agenticRealEnabled,
        mode: config.agenticRealEnabled ? "real-configured" : "mock",
      },
    });
  });

  api.get("/api/profiles", async (c) => c.json({ profiles: await profiles.listPublic() }));

  api.post("/api/profiles", async (c) => {
    const body = await c.req.json<{
      label?: string;
      secrets?: ProfileSecrets;
    }>();
    const profile = await profiles.save(body.label ?? "", body.secrets ?? {});
    repository.audit({
      appId,
      correlationId: profile.id,
      action: "profile.create",
      outcome: "success",
      payload: { profileId: profile.id, label: profile.label },
    });
    return c.json({ profile }, 201);
  });

  api.post("/api/profiles/preferred", async (c) => {
    const body = await c.req.json<{ profileId?: string }>();
    const profile = body.profileId ? await profiles.getPublic(body.profileId) : undefined;
    if (!profile) return c.json({ error: "Unknown profile." }, 404);
    await writePreferredProfile(c, appId, profile.id, config.signingSecret);
    repository.audit({
      appId,
      correlationId: profile.id,
      action: "profile.preferred",
      outcome: "success",
      payload: { profileId: profile.id },
    });
    return c.json({ profile });
  });

  api.delete("/api/profiles/:id", (c) => {
    const id = c.req.param("id");
    const deleted = profiles.delete(id);
    repository.audit({
      appId,
      correlationId: id,
      action: "profile.delete",
      outcome: deleted ? "success" : "not_found",
      payload: { profileId: id },
    });
    return deleted ? c.json({ deleted: true }) : c.json({ error: "Profile not found." }, 404);
  });

  api.post("/api/callbacks", async (c) => {
    const body = await c.req.json<{
      correlationId?: string;
      name?: string;
      payload?: unknown;
      occurredAt?: string;
    }>();
    if (!body.correlationId || !body.name) {
      return c.json({ error: "correlationId and name are required." }, 400);
    }
    const id = repository.recordCallback({
      appId,
      correlationId: body.correlationId,
      name: body.name,
      payload: sanitize(body.payload),
      occurredAt: body.occurredAt,
    });
    return c.json({ id }, 201);
  });

  api.get("/api/timeline/:correlationId", (c) => {
    return c.json({
      entries: repository.timeline(c.req.param("correlationId")),
    });
  });

  return { appId, config, repository, profiles, api };
}

export async function selectedSecrets(
  context: PlatformContext,
  request: Request,
): Promise<{ id: string; secrets: ProfileSecrets }> {
  let id = "default";
  // The bootstrap response resolves the signed HttpOnly preference cookie.
  // Subsequent same-origin calls repeat that non-secret profile id explicitly.
  const requested = request.headers.get("x-profile-id");
  if (requested && await context.profiles.getPublic(requested)) id = requested;
  const secrets = await context.profiles.getSecrets(id);
  if (!secrets) throw new Error("Selected profile is unavailable.");
  return { id, secrets };
}

// Spec: knowledge/components/platform-package.md
import { getCookie, setCookie } from "jsr:@hono/hono@4.12.31/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { isIP } from "node:net";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function signedValue(secret: string, value: string): Promise<string> {
  return `${toBase64Url(encoder.encode(value))}.${await hmac(secret, value)}`;
}

export async function verifySignedValue(
  secret: string,
  signed: string | undefined,
): Promise<string | undefined> {
  if (!signed) return undefined;
  const [encoded, signature] = signed.split(".");
  if (!encoded || !signature) return undefined;
  let value: string;
  try {
    value = decoder.decode(fromBase64(encoded));
  } catch {
    return undefined;
  }
  const expected = await hmac(secret, value);
  const left = encoder.encode(signature);
  const right = encoder.encode(expected);
  if (left.byteLength !== right.byteLength) return undefined;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0 ? value : undefined;
}

export interface SessionContext {
  id: string;
  csrfToken: string;
}

export async function ensureSession(c: Context, signingSecret: string): Promise<SessionContext> {
  const secure = new URL(c.req.url).protocol === "https:";
  const signedSession = getCookie(c, "adyen_session");
  let sessionId = await verifySignedValue(signingSecret, signedSession);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setCookie(c, "adyen_session", await signedValue(signingSecret, sessionId), {
      httpOnly: true,
      sameSite: "Strict",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  let csrfToken = getCookie(c, "adyen_csrf");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    setCookie(c, "adyen_csrf", csrfToken, {
      httpOnly: false,
      sameSite: "Strict",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return { id: sessionId, csrfToken };
}

// "localhost" and "127.0.0.1" are the same loopback host for local dev
// purposes, but the browser's Origin header and a hand-set PUBLIC_ORIGIN
// rarely agree on which spelling to use, normalize both to one form so
// switching between them doesn't trip the check below.
function normalizeHost(host: string): string {
  return host.replace(/^localhost(?=:|$)/, "127.0.0.1");
}

// Host-only comparison (scheme ignored: Render terminates TLS and forwards
// over plain http internally). Accepts the host the request actually arrived
// on as well as the configured PUBLIC_ORIGIN, PUBLIC_ORIGIN is a fixed env
// var, so a renamed service, a custom domain or a www/non-www visit would
// otherwise 403 real users even though the request is genuinely same-origin.
function sameOriginHost(request: Request, publicOrigin: string, origin: string): boolean {
  const requestHosts = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    new URL(request.url).host,
  ];
  const allowedHosts = new Set(
    [new URL(publicOrigin).host, ...requestHosts]
      .filter((host): host is string => Boolean(host))
      .map((host) => normalizeHost(host.split(",")[0].trim())),
  );
  try {
    return allowedHosts.has(normalizeHost(new URL(origin).host));
  } catch {
    return false;
  }
}

/**
 * The origin the shopper's browser is actually on, for `returnUrl` and the
 * 3DS `origin` field. PUBLIC_ORIGIN is right in a deployment, but locally the
 * same app is reached on 8001 through `dev:digital`, on Vite's 5173 through
 * `deno task dev`, or on a tunnel, and a redirect back to the wrong one lands
 * on a dead page. Only a same-origin Origin header is trusted.
 */
export function requestOrigin(request: Request, publicOrigin: string): string {
  const origin = request.headers.get("origin");
  return origin && sameOriginHost(request, publicOrigin, origin)
    ? new URL(origin).origin
    : publicOrigin;
}

/**
 * The shopper's IP, for Adyen's risk checks (`shopperIP` on /payments).
 * Behind Render the connection is the proxy's, so the first X-Forwarded-For
 * entry wins, as in rateLimit. A shopper can forge it, which on this TEST
 * playground only misleads the risk checks on their own payment. Without the
 * header (the Docker image run locally) the connection's address is used.
 */
export function shopperIp(request: Request, info?: Deno.ServeHandlerInfo): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const remote = info?.remoteAddr && "hostname" in info.remoteAddr
    ? info.remoteAddr.hostname
    : undefined;
  for (const candidate of [forwarded, remote]) {
    // A dual-stack socket reports an IPv4 shopper as ::ffff:a.b.c.d.
    const ip = candidate?.replace(/^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i, "");
    if (ip && isIP(ip)) return ip;
  }
  return undefined;
}

export function csrfProtection(signingSecret: string, publicOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    // Checked before ensureSession, so a rejected request never issues
    // cookies. A first visit's POST can race the page's own GET
    // /api/bootstrap; answering it with a fresh token replaced the one
    // bootstrap had just set, and the next POST failed with a stale header.
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      // The real protection: a double-submit token the browser only ever
      // exposes to same-origin script, backed by SameSite=Strict on the
      // session cookie. A genuine cross-site attacker can't read either.
      const cookieToken = getCookie(c, "adyen_csrf");
      const headerToken = c.req.header("x-csrf-token");
      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return c.json({ error: "CSRF validation failed." }, 403);
      }
      const origin = c.req.header("origin");
      if (origin && !sameOriginHost(c.req.raw, publicOrigin, origin)) {
        return c.json({ error: "Cross-origin request rejected." }, 403);
      }
    }
    c.set("session", await ensureSession(c, signingSecret));
    await next();
  };
}

export function preferredProfileCookieName(appId: string): string {
  return `adyen_profile_${appId}`;
}

export async function readPreferredProfile(
  c: Context,
  appId: string,
  signingSecret: string,
): Promise<string | undefined> {
  return await verifySignedValue(signingSecret, getCookie(c, preferredProfileCookieName(appId)));
}

export async function writePreferredProfile(
  c: Context,
  appId: string,
  profileId: string,
  signingSecret: string,
): Promise<void> {
  setCookie(c, preferredProfileCookieName(appId), await signedValue(signingSecret, profileId), {
    httpOnly: true,
    sameSite: "Strict",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

interface RateBucket {
  count: number;
  resetsAt: number;
}

export function rateLimit(maxRequests = 120, windowMs = 60_000): MiddlewareHandler {
  const buckets = new Map<string, RateBucket>();
  return async (c, next) => {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const key = `${forwarded ?? "local"}:${new URL(c.req.url).pathname}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      buckets.set(key, { count: 1, resetsAt: now + windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > maxRequests) {
        c.header("Retry-After", String(Math.ceil((bucket.resetsAt - now) / 1000)));
        return c.json({ error: "Rate limit exceeded." }, 429);
      }
    }
    if (buckets.size > 5_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetsAt <= now) buckets.delete(bucketKey);
      }
    }
    await next();
  };
}

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    applySecurityHeaders(c.res.headers);
  };
}

export function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  // No Content-Security-Policy: on this TEST playground it kept blocking
  // legitimate Adyen/wallet subresources one host at a time (icons, wallet
  // SDKs, 3DS). Adyen's own iframes remain the real PCI boundary regardless
  // of our page CSP, so it wasn't buying real protection here, only churn.
}

const BASIC_AUTH_REALM = 'Basic realm="Adyen TEST Playground"';

/**
 * The 401 to answer with when PLAYGROUND_BASIC_AUTH_* is set and the request
 * does not carry those credentials, otherwise undefined. Framework-free so
 * each app's main.ts can run it before Fresh: as a Hono middleware alone it
 * only ever covered /api/*, leaving every page public and flow pages
 * crashing on their in-process bootstrap call.
 */
export function basicAuthChallenge(request: Request): Response | undefined {
  const username = Deno.env.get("PLAYGROUND_BASIC_AUTH_USER");
  const password = Deno.env.get("PLAYGROUND_BASIC_AUTH_PASSWORD");
  if (!username || !password) return undefined;
  const path = new URL(request.url).pathname;
  if (path === "/healthz" || path === "/api/health") return undefined;
  const header = request.headers.get("authorization");
  let decoded = "";
  try {
    decoded = header?.startsWith("Basic ") ? atob(header.slice(6)) : "";
  } catch {
    decoded = "";
  }
  if (decoded === `${username}:${password}`) return undefined;
  // Sent on every 401, so a browser asks again after a wrong password.
  return new Response(header ? "Invalid authentication" : "Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": BASIC_AUTH_REALM },
  });
}

export function optionalBasicAuth(): MiddlewareHandler {
  return async (c, next) => basicAuthChallenge(c.req.raw) ?? await next();
}

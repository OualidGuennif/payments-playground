// Spec: knowledge/components/platform-package.md
// Framework-free on purpose: base-api.ts runs these before Elysia sees a request, the Next proxy runs
// the Basic Auth check before a page renders, and the tests call them on plain Requests.
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

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  maxAge: number;
}

/** The cookies a request carried, and the Set-Cookie lines issued in answer to it. */
export class CookieJar {
  readonly #values = new Map<string, string>();
  readonly #issued = new Map<string, string>();

  constructor(request: Request) {
    for (const part of (request.headers.get("cookie") ?? "").split(";")) {
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const name = part.slice(0, separator).trim();
      const raw = part.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
      try {
        this.#values.set(name, decodeURIComponent(raw));
      } catch {
        this.#values.set(name, raw);
      }
    }
  }

  get(name: string): string | undefined {
    return this.#values.get(name);
  }

  set(name: string, value: string, options: CookieOptions): void {
    this.#values.set(name, value);
    const attributes = [
      `${name}=${encodeURIComponent(value)}`,
      `Max-Age=${options.maxAge}`,
      "Path=/",
      ...(options.httpOnly ? ["HttpOnly"] : []),
      ...(options.secure ? ["Secure"] : []),
      "SameSite=Strict",
    ];
    this.#issued.set(name, attributes.join("; "));
  }

  get issued(): string[] {
    return [...this.#issued.values()];
  }
}

export interface SessionContext {
  id: string;
  csrfToken: string;
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export async function ensureSession(
  request: Request,
  jar: CookieJar,
  signingSecret: string,
): Promise<SessionContext> {
  const secure = isSecure(request);
  let sessionId = await verifySignedValue(signingSecret, jar.get("adyen_session"));
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    jar.set("adyen_session", await signedValue(signingSecret, sessionId), {
      httpOnly: true,
      secure,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return { id: sessionId, csrfToken: ensureCsrfToken(request, jar) };
}

/**
 * The double-submit token, issued when the request carried none. It needs no
 * secret, so a page response can carry it before the page's first POST.
 */
export function ensureCsrfToken(request: Request, jar: CookieJar): string {
  let csrfToken = jar.get("adyen_csrf");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    jar.set("adyen_csrf", csrfToken, {
      httpOnly: false,
      secure: isSecure(request),
      maxAge: 60 * 60 * 24,
    });
  }
  return csrfToken;
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
 * same app is reached on its documented port, on Next's default 3000 or on a
 * tunnel, and a redirect back to the wrong one lands on a dead page. Only a
 * same-origin Origin header is trusted.
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
 * entry wins, as in the rate limit. A shopper can forge it, which on this TEST
 * playground only misleads the risk checks on their own payment. Without the
 * header the connection's address, when the caller knows it, is used.
 */
export function shopperIp(request: Request, remoteAddress?: string): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  for (const candidate of [forwarded, remoteAddress]) {
    // A dual-stack socket reports an IPv4 shopper as ::ffff:a.b.c.d.
    const ip = candidate?.replace(/^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i, "");
    if (ip && isIP(ip)) return ip;
  }
  return undefined;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

/**
 * The 403 for a mutation that fails the CSRF checks, otherwise undefined.
 * Checked before ensureSession, so a rejected request never issues cookies. A
 * first visit's POST can race the page's own GET /api/bootstrap; answering it
 * with a fresh token replaced the one bootstrap had just set, and the next
 * POST failed with a stale header.
 */
export function csrfRejection(
  request: Request,
  jar: CookieJar,
  publicOrigin: string,
): Response | undefined {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return undefined;
  // The real protection: a double-submit token the browser only ever
  // exposes to same-origin script, backed by SameSite=Strict on the
  // session cookie. A genuine cross-site attacker can't read either.
  const cookieToken = jar.get("adyen_csrf");
  const headerToken = request.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return json({ error: "CSRF validation failed." }, 403);
  }
  const origin = request.headers.get("origin");
  if (origin && !sameOriginHost(request, publicOrigin, origin)) {
    return json({ error: "Cross-origin request rejected." }, 403);
  }
  return undefined;
}

export function preferredProfileCookieName(appId: string): string {
  return `adyen_profile_${appId}`;
}

export async function readPreferredProfile(
  jar: CookieJar,
  appId: string,
  signingSecret: string,
): Promise<string | undefined> {
  return await verifySignedValue(signingSecret, jar.get(preferredProfileCookieName(appId)));
}

export async function writePreferredProfile(
  request: Request,
  jar: CookieJar,
  appId: string,
  profileId: string,
  signingSecret: string,
): Promise<void> {
  jar.set(preferredProfileCookieName(appId), await signedValue(signingSecret, profileId), {
    httpOnly: true,
    secure: isSecure(request),
    maxAge: 60 * 60 * 24 * 365,
  });
}

interface RateBucket {
  count: number;
  resetsAt: number;
}

/** Per client and path; answers the 429 once a client is over the limit, otherwise undefined. */
export function rateLimiter(
  maxRequests = 120,
  windowMs = 60_000,
): (request: Request) => Response | undefined {
  const buckets = new Map<string, RateBucket>();
  return (request) => {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const key = `${forwarded ?? "local"}:${new URL(request.url).pathname}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      buckets.set(key, { count: 1, resetsAt: now + windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > maxRequests) {
        const retryAfter = String(Math.ceil((bucket.resetsAt - now) / 1000));
        return json({ error: "Rate limit exceeded." }, 429, { "Retry-After": retryAfter });
      }
    }
    if (buckets.size > 5_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetsAt <= now) buckets.delete(bucketKey);
      }
    }
    return undefined;
  };
}

/** Also listed in each app's next.config.ts headers(), which covers the pages. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  // No Content-Security-Policy: on this TEST playground it kept blocking
  // legitimate Adyen/wallet subresources one host at a time (icons, wallet
  // SDKs, 3DS). Adyen's own iframes remain the real PCI boundary regardless
  // of our page CSP, so it wasn't buying real protection here, only churn.
};

export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
}

const BASIC_AUTH_REALM = 'Basic realm="Adyen TEST Playground"';

/**
 * The 401 to answer with when PLAYGROUND_BASIC_AUTH_* is set and the request
 * does not carry those credentials, otherwise undefined. Each app's Next
 * proxy runs it before a page renders and base-api.ts before the API, so no
 * page or route is public by omission.
 */
export function basicAuthChallenge(request: Request): Response | undefined {
  const username = process.env.PLAYGROUND_BASIC_AUTH_USER;
  const password = process.env.PLAYGROUND_BASIC_AUTH_PASSWORD;
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

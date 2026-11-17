// Spec: knowledge/components/adyen-agentic-commerce.md
// UCP 2026-08-25 negotiation, business side: resolve the platform profile a request names, check
// it, and keep the capabilities both sides support at a common version.
import { isIP } from "node:net";
import { UCP_VERSION } from "./config";
import { metadataUrlAllowed } from "./oauth";
import { isRecord } from "./util";

// UCP's negotiation errors: REST status; MCP answers each with JSON-RPC -32001.
const STATUS = {
  invalid_profile_url: 400,
  profile_unreachable: 424,
  profile_malformed: 422,
  version_unsupported: 422,
} as const;

export class ProfileError extends Error {
  readonly status: number;
  constructor(
    readonly code: keyof typeof STATUS,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

const MAX_URL = 2048;
const MAX_BYTES = 256 * 1024; // UCP asks verifiers for a bound of no less than 128 KiB.
const TIMEOUT_MS = 5000;
const DEFAULT_TTL = 300;
const MAX_TTL = 3600;
const MAX_CACHED = 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REVERSE_DOMAIN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9_])?)+$/;
const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

// --- the URL ----------------------------------------------------------------------------------

// UCP-Agent is an RFC 8941 Dictionary; only its `profile` member, an sf-string, is read.
// undefined: no header at all.
export function profileFromHeader(value: string | null): string | undefined {
  if (value === null) return undefined;
  const member = /(?:^|,)\s*profile="((?:[^"\\]|\\["\\])*)"\s*(?:;[^,]*)?(?=,|$)/.exec(value);
  if (!member) throw new ProfileError("invalid_profile_url", 'UCP-Agent needs profile="<url>"');
  return member[1]!.replace(/\\(["\\])/g, "$1");
}

function checkUrl(raw: string): URL {
  const refuse = (why: string) => new ProfileError("invalid_profile_url", why);
  if (!raw || raw.length > MAX_URL)
    throw refuse(`The profile URL must be 1 to ${MAX_URL} characters`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refuse("The profile URL does not parse");
  }
  if (!metadataUrlAllowed(url)) throw refuse("The profile URL must be https");
  if (url.username || url.password) throw refuse("The profile URL must not carry credentials");
  // Profiles live on domain names; an address literal is how a fetch is aimed inside a network.
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && url.protocol === "https:")
    throw refuse("The profile URL must name a host, not an IP address");
  return url;
}

// --- fetching and caching ---------------------------------------------------------------------

type PlatformProfile = { version: string; capabilities: Record<string, unknown[]> };
const cache = new Map<string, { profile: PlatformProfile; expires: number }>();

export const forgetProfiles = () => cache.clear();

function ttlOf(cacheControl: string | null): number {
  const directives = (cacheControl ?? "").toLowerCase();
  if (/(^|,)\s*(no-store|no-cache)\b/.test(directives)) return 0;
  const maxAge = /(^|,)\s*max-age=(\d+)/.exec(directives)?.[2];
  return maxAge === undefined ? DEFAULT_TTL : Math.min(Number(maxAge), MAX_TTL);
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES)
    throw new ProfileError("profile_malformed", "The profile is over 256 KiB");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ProfileError("profile_malformed", "The profile is over 256 KiB");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchProfile(url: URL): Promise<{ doc: unknown; ttl: number }> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ProfileError("profile_unreachable", "The profile could not be fetched");
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new ProfileError(
      "profile_unreachable",
      response.status >= 300 && response.status < 400
        ? "The profile URL redirects; profiles must not"
        : `The profile URL answered ${response.status}`,
    );
  }
  let text: string;
  try {
    text = await readBounded(response);
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError("profile_unreachable", "The profile could not be read");
  }
  try {
    return { doc: JSON.parse(text), ttl: ttlOf(response.headers.get("cache-control")) };
  } catch {
    throw new ProfileError("profile_malformed", "The profile is not JSON");
  }
}

// --- the platform profile shape (profile.json#/$defs/platform_schema) --------------------------

function readPlatformProfile(doc: unknown): PlatformProfile {
  const bad = (why: string) => new ProfileError("profile_malformed", why);
  if (!isRecord(doc) || !isRecord(doc.ucp)) throw bad("ucp is required");
  const { ucp } = doc;
  if (typeof ucp.version !== "string" || !DATE.test(ucp.version))
    throw bad("ucp.version must be a YYYY-MM-DD date");
  const registry = (value: unknown) =>
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entries]) =>
        REVERSE_DOMAIN.test(key) && Array.isArray(entries) && entries.every(isRecord),
    );
  for (const name of ["services", "payment_handlers"] as const)
    if (!registry(ucp[name]))
      throw bad(`ucp.${name} must be a registry keyed by reverse-domain names`);
  const capabilities = ucp.capabilities ?? {};
  if (!registry(capabilities)) throw bad("ucp.capabilities must be a registry");
  for (const [name, entries] of Object.entries(capabilities as Record<string, unknown[]>)) {
    for (const entry of entries as Record<string, unknown>[]) {
      const parents = entry.extends;
      if (
        typeof entry.version !== "string" ||
        !DATE.test(entry.version) ||
        typeof entry.spec !== "string" ||
        typeof entry.schema !== "string" ||
        !(
          parents === undefined ||
          typeof parents === "string" ||
          (Array.isArray(parents) &&
            parents.length > 0 &&
            parents.every((p) => typeof p === "string"))
        )
      )
        throw bad(`${name} needs a dated version, spec and schema`);
    }
  }
  if (doc.keys !== undefined) {
    if (!Array.isArray(doc.keys)) throw bad("keys must be an array");
    for (const key of doc.keys) {
      if (!isRecord(key) || typeof key.kid !== "string" || typeof key.kty !== "string")
        throw bad("each key needs kid and kty");
      if (PRIVATE_JWK_MEMBERS.some((m) => m in key)) throw bad("keys must be public keys only");
    }
  }
  return {
    version: ucp.version,
    capabilities: capabilities as Record<string, unknown[]>,
  };
}

async function resolve(url: URL): Promise<PlatformProfile> {
  const key = url.href;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.profile;
  const { doc, ttl } = await fetchProfile(url);
  const profile = readPlatformProfile(doc);
  cache.delete(key);
  if (ttl > 0) {
    if (cache.size >= MAX_CACHED) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    }
    cache.set(key, { profile, expires: Date.now() + ttl * 1000 });
  }
  return profile;
}

// --- negotiation ------------------------------------------------------------------------------

// UCP authority binding: the schema's https host, reversed, is the name or a label prefix of it.
function schemaOwnsName(name: string, schema: unknown): boolean {
  if (typeof schema !== "string") return false;
  let url: URL;
  try {
    url = new URL(schema);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".")) return false;
  const authority = host.split(".").reverse().join(".");
  return name === authority || name.startsWith(`${authority}.`);
}

// The store's capabilities all sit at UCP_VERSION and extend nothing, so no orphan can remain.
export function intersect(ours: readonly string[], theirs: Record<string, unknown[]>): Set<string> {
  const shared = new Set<string>();
  for (const name of ours) {
    const entries = (theirs[name] ?? []) as Record<string, unknown>[];
    if (entries.some((e) => e.version === UCP_VERSION && schemaOwnsName(name, e.schema)))
      shared.add(name);
  }
  return shared;
}

// The capabilities this request may use, from the profile it names.
export async function negotiate(raw: string, ours: readonly string[]): Promise<Set<string>> {
  const profile = await resolve(checkUrl(raw));
  if (profile.version !== UCP_VERSION)
    throw new ProfileError(
      "version_unsupported",
      `UCP ${profile.version} is not supported; this business implements ${UCP_VERSION}`,
    );
  return intersect(ours, profile.capabilities);
}

// Spec: knowledge/components/adyen-agentic-commerce.md
// The device authorization grant (RFC 8628): the request, the user code and the limits on guessing
// it.
import { count, findBy, get, put, removeExpired } from "../core/db";
import { newId, secret, sha256 } from "../core/util";
import {
  type AuthRequest,
  DEVICE_GRANT,
  DEVICE_INTERVAL,
  DEVICE_REQUESTS_MAX,
  DEVICE_TTL,
  type DeviceRequest,
  issuer,
  nowSec,
  OAuthError,
  requestedResources,
  requestedScopes,
} from "./shared";
import { authenticateClient, clientGrants } from "./clients";

// RFC 8628 §6.1: no vowels, so a code never spells a word, and nothing that reads as a digit.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

function newUserCode(): string {
  const letters: string[] = [];
  while (letters.length < 8) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!;
    // 240 is the largest multiple of 20 below 256: dropping the rest keeps every letter as likely.
    if (byte < 240) letters.push(USER_CODE_ALPHABET[byte % 20]!);
  }
  return letters.join("");
}

export const formatUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function pendingDevice(id: string): DeviceRequest | undefined {
  const device = get<DeviceRequest>("device_requests", id);
  return device?.status === "pending" && device.expiresAt >= nowSec() ? device : undefined;
}

// Starts a device sign-in for a client that declared the grant; returns the RFC 8628 §3.2 answer.
export async function startDeviceAuthorization(form: URLSearchParams) {
  const client = await authenticateClient(form);
  if (!clientGrants(client).includes(DEVICE_GRANT))
    throw new OAuthError(
      "unauthorized_client",
      `Register with grant_types including ${DEVICE_GRANT}`,
    );
  // A URL client_id is shown to the shopper as a verified host. Without a callback on that host,
  // only a signed assertion proves the caller runs it; anyone could start a public one's sign-in.
  if (client.kind === "metadata-document" && client.authMethod === "none")
    throw new OAuthError(
      "unauthorized_client",
      "A client identified by a URL signs its device requests (private_key_jwt)",
    );
  const scopes = requestedScopes(form.get("scope"), client);
  if (typeof scopes === "string") throw new OAuthError("invalid_scope", scopes);
  const resources = requestedResources(form.getAll("resource"));
  // An expired request still answers a late poll with expired_token; one lifetime later it goes.
  removeExpired("device_requests", nowSec() - DEVICE_TTL);
  // The per-address limit cannot stop a caller with many addresses (an IPv6 prefix, a botnet):
  // this bounds the store and every user-code scan whatever the addresses, at the cost of new
  // starts during a flood.
  if (count("device_requests") >= DEVICE_REQUESTS_MAX)
    throw new OAuthError(
      "temporarily_unavailable",
      "Too many device sign-ins in progress; try again later",
      503,
    );
  const deviceCode = secret();
  let userCode = newUserCode();
  // Two pending requests must never share a user code; with 20^8 codes a retry is rare.
  while (
    findBy<DeviceRequest>("device_requests", "userCode", userCode).some((d) => pendingDevice(d.id))
  )
    userCode = newUserCode();
  put<DeviceRequest>("device_requests", sha256(deviceCode), {
    id: sha256(deviceCode),
    clientId: client.clientId,
    clientName: client.name,
    userCode,
    scopes,
    resources,
    expiresAt: nowSec() + DEVICE_TTL,
    interval: DEVICE_INTERVAL,
    status: "pending",
  });
  const verification = `${issuer()}/device`;
  return {
    device_code: deviceCode,
    user_code: formatUserCode(userCode),
    verification_uri: verification,
    verification_uri_complete: `${verification}?user_code=${formatUserCode(userCode)}`,
    expires_in: DEVICE_TTL,
    interval: DEVICE_INTERVAL,
  };
}

const CODE_WINDOW_MS = 10 * 60_000;
const CODE_MISSES_PER_ADDRESS = 10;
const CODE_MISSES_TOTAL = 200;
// A caller can hold many addresses (an IPv6 prefix, or any header on a run without Cloudflare), so
// the map is capped and keys are cut short: otherwise each would stay in memory for the process.
const CODE_MISS_ADDRESSES = 1000;
const codeMisses = new Map<string, number[]>();

function recentMisses(key: string, now: number): number[] {
  const kept = (codeMisses.get(key) ?? []).filter((t) => now - t < CODE_WINDOW_MS);
  if (kept.length) codeMisses.set(key, kept);
  else codeMisses.delete(key);
  return kept;
}

function recordMiss(key: string, now: number) {
  const kept = recentMisses(key, now);
  if (!codeMisses.has(key) && codeMisses.size >= CODE_MISS_ADDRESSES) {
    // Maps iterate in insertion order: the oldest address goes, never the total.
    for (const oldest of codeMisses.keys()) {
      if (oldest !== "*") {
        codeMisses.delete(oldest);
        break;
      }
    }
  }
  codeMisses.set(key, [...kept, now]);
}

export const trackedMissAddresses = () => codeMisses.size;
// Each test starts with no misses, whatever ran before it.
export const forgetCodeMisses = () => codeMisses.clear();

// The shopper's typed code becomes a consent request. Wrong codes are counted per address and in
// total; past either limit every code is refused, a right one included, so guessing cannot win.
export function verifyUserCode(
  raw: string,
  address: string,
): { requestId: string } | { error: "invalid_code" | "too_many_attempts" } {
  const now = Date.now();
  // Prefixed so that no address can be the "*" total.
  const from = `a:${address.slice(0, 64)}`;
  if (
    recentMisses(from, now).length >= CODE_MISSES_PER_ADDRESS ||
    recentMisses("*", now).length >= CODE_MISSES_TOTAL
  )
    return { error: "too_many_attempts" };
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "");
  const device = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code)
    ? findBy<DeviceRequest>("device_requests", "userCode", code)
        .map((d) => pendingDevice(d.id))
        .find(Boolean)
    : undefined;
  if (!device) {
    for (const key of [from, "*"]) recordMiss(key, now);
    return { error: "invalid_code" };
  }
  const request: AuthRequest = {
    id: newId("ar", 18),
    clientId: device.clientId,
    clientName: device.clientName,
    device: device.id,
    scopes: device.scopes,
    resources: device.resources,
    expiresAt: device.expiresAt,
  };
  put("auth_requests", request.id, request);
  return { requestId: request.id };
}

// Spec: knowledge/components/adyen-agentic-commerce.md
// Customer accounts (ADR-015): email and password, passkeys, and the session cookie that carries
// them. Only hashes are stored: a session is found by the SHA-256 of its cookie, a password by
// its argon2id hash, and a passkey keeps its public key alone.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { config } from "../core/config";
import { count, findBy, get, put, remove, removeExpired } from "../core/db";
import { isRecord, newId, secret, sha256 } from "../core/util";

export type Customer = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  // WebAuthn's user handle: random, so an authenticator never stores the email.
  webauthnUserId: string;
  createdAt: string;
};

export type Passkey = {
  id: string;
  customerId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  createdAt: string;
  lastUsedAt?: string;
};

// createdAt and confirmedAt (unix seconds) date the sign-in and the last password or passkey proof;
// a session stored before v0.13.0 has neither (ADR-021).
type CustomerSession = {
  id: string;
  customerId: string;
  expiresAt: number;
  createdAt?: number;
  confirmedAt?: number;
};

type Challenge = {
  id: string;
  challenge: string;
  purpose: "register" | "login" | "confirm";
  customerId?: string;
  expiresAt: number;
};

export class CustomerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const SESSION_TTL = 7 * 24 * 3600;
const CHALLENGE_TTL = 300;
// Anyone may ask for sign-in options, so the stored challenges are capped like device requests.
export const CHALLENGES_MAX = 1000;
const PASSKEYS_MAX = 10;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const nowSec = () => Math.floor(Date.now() / 1000);
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;

// A loopback http origin cannot keep a __Host- cookie (it needs Secure), so local runs drop both.
const secureOrigin = () => config().publicOrigin.startsWith("https://");
export const sessionCookieName = () =>
  secureOrigin() ? "__Host-velune_session" : "velune_session";

function cookie(value: string, maxAge: number): string {
  const parts = [`${sessionCookieName()}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  parts.push(`Max-Age=${maxAge}`);
  if (secureOrigin()) parts.push("Secure");
  return parts.join("; ");
}

export const clearedSessionCookie = () => cookie("", 0);

export function tokenFromCookies(header: string | null): string | undefined {
  const name = sessionCookieName();
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || undefined;
  }
  return undefined;
}

export function customerFromToken(token: string | undefined): Customer | undefined {
  if (!token) return undefined;
  const session = get<CustomerSession>("customer_sessions", sha256(token));
  if (!session || session.expiresAt < nowSec()) return undefined;
  return get<Customer>("customers", session.customerId);
}

export const customerFromCookies = (header: string | null) =>
  customerFromToken(tokenFromCookies(header));

function sessionFromCookies(header: string | null): CustomerSession | undefined {
  const token = tokenFromCookies(header);
  const session = token ? get<CustomerSession>("customer_sessions", sha256(token)) : undefined;
  return session && session.expiresAt >= nowSec() ? session : undefined;
}

// Paying in the chat needs a proof this recent (ADR-021); the session alone does for the rest.
export const CHAT_PAY_FRESH_SECONDS = 3600;

// Until when (unix seconds) the session counts as freshly proven: 0 when there is no session or
// it predates the timestamps, so it fails closed and asks once.
export function sessionProvenUntil(header: string | null): number {
  const session = sessionFromCookies(header);
  const verifiedAt = session?.confirmedAt ?? session?.createdAt;
  return verifiedAt ? verifiedAt + CHAT_PAY_FRESH_SECONDS : 0;
}

export const isSessionFresh = (header: string | null, now = nowSec()) =>
  now < sessionProvenUntil(header);

// Called only after confirmIdentity succeeded for this session's customer.
export function touchSessionConfirmation(header: string | null, now = nowSec()): void {
  const session = sessionFromCookies(header);
  if (session)
    put<CustomerSession>("customer_sessions", session.id, { ...session, confirmedAt: now });
}

export const customerById = (id: string | undefined) =>
  id ? get<Customer>("customers", id) : undefined;

function startSession(customer: Customer): string {
  removeExpired("customer_sessions", nowSec());
  const token = secret();
  const now = nowSec();
  // A sign-in is a proof: password, passkey or a new account's password (ADR-021).
  put<CustomerSession>("customer_sessions", sha256(token), {
    id: sha256(token),
    customerId: customer.id,
    expiresAt: now + SESSION_TTL,
    createdAt: now,
    confirmedAt: now,
  });
  return cookie(token, SESSION_TTL);
}

export function signOut(header: string | null): string {
  const token = tokenFromCookies(header);
  if (token) remove("customer_sessions", sha256(token));
  return clearedSessionCookie();
}

// --- failed attempts --------------------------------------------------------------------------

const WINDOW_MS = 15 * 60_000;
const FAILURES_MAX = 10;
const SIGNUPS_MAX = 10;
const TRACKED_MAX = 10_000;
const failures = new Map<string, { start: number; count: number }>();

function tooMany(key: string, max: number): number | undefined {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.start > WINDOW_MS || entry.count < max) return undefined;
  return Math.ceil((entry.start + WINDOW_MS - Date.now()) / 1000);
}

function countFailure(key: string): void {
  const entry = failures.get(key);
  if (entry && Date.now() - entry.start <= WINDOW_MS) {
    entry.count += 1;
    return;
  }
  if (!entry && failures.size >= TRACKED_MAX) failures.delete(failures.keys().next().value!);
  failures.set(key, { start: Date.now(), count: 1 });
}

function uncountFailure(key: string): void {
  const entry = failures.get(key);
  if (entry && entry.count > 0) entry.count -= 1;
}

export const forgetFailures = () => failures.clear();

function refuseWhenLimited(keys: [string, number][]): void {
  for (const [key, max] of keys) {
    const retry = tooMany(key, max);
    if (retry)
      throw new CustomerError(
        429,
        "too_many_attempts",
        "Too many attempts; try again later",
        retry,
      );
  }
}

// --- password accounts ------------------------------------------------------------------------

function field(body: unknown, name: string): string {
  const value = isRecord(body) ? body[name] : undefined;
  return typeof value === "string" ? value : "";
}

export async function signUp(body: unknown, address: string) {
  refuseWhenLimited([[`signup:${address}`, SIGNUPS_MAX]]);
  const email = field(body, "email").trim().toLowerCase();
  const name = field(body, "name").trim().slice(0, 80);
  const password = field(body, "password");
  if (!EMAIL.test(email) || email.length > 254)
    throw new CustomerError(400, "invalid_email", "Enter a valid email address");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
    throw new CustomerError(
      400,
      "weak_password",
      `Use a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`,
    );
  // Every attempt costs an argon2id hash, so attempts count whether or not they succeed.
  countFailure(`signup:${address}`);
  if (findBy<Customer>("customers", "email", email).length)
    throw new CustomerError(409, "email_taken", "An account already uses this email");
  const customer: Customer = {
    id: newId("cus"),
    email,
    name: name || email.split("@")[0]!,
    passwordHash: await Bun.password.hash(password, { algorithm: "argon2id" }),
    webauthnUserId: secret(32),
    createdAt: new Date().toISOString(),
  };
  // Checked again after the await: two sign-ups with one email at once keep only the first.
  if (findBy<Customer>("customers", "email", email).length)
    throw new CustomerError(409, "email_taken", "An account already uses this email");
  put("customers", customer.id, customer);
  return { customer, cookie: startSession(customer) };
}

// The Pay modal's email check (ADR-020): whether an address has an account, nothing about it.
export const hasAccount = (email: string): boolean =>
  findBy<Customer>("customers", "email", email.trim().toLowerCase()).length > 0;

// Unknown emails are checked against this hash too, so both failures take the same time.
let decoy: Promise<string> | undefined;

export async function signIn(body: unknown, address: string) {
  const email = field(body, "email").trim().toLowerCase();
  const password = field(body, "password");
  const keys = [`ip:${address}`, `email:${email}`];
  refuseWhenLimited(keys.map((key) => [key, FAILURES_MAX]));
  // Counted before the hash is checked, with nothing awaited since the limit check: a burst of
  // attempts sent at once meets the limit one by one. A right password takes its count back.
  for (const key of keys) countFailure(key);
  const customer = findBy<Customer>("customers", "email", email)[0];
  decoy ??= Bun.password.hash(secret(), { algorithm: "argon2id" });
  const valid = await Bun.password.verify(
    password.slice(0, PASSWORD_MAX),
    customer?.passwordHash ?? (await decoy),
  );
  if (!customer || !valid) throw new CustomerError(401, "invalid_login", "Wrong email or password");
  for (const key of keys) uncountFailure(key);
  return { customer, cookie: startSession(customer) };
}

// --- passkeys ---------------------------------------------------------------------------------

// WebAuthn takes no IP address as an RP ID, so a loopback run serves passkeys on localhost: open
// the store at http://localhost:<port> to use them there.
const rp = () => {
  const url = new URL(config().publicOrigin);
  if (url.hostname === "127.0.0.1" || url.hostname === "[::1]") url.hostname = "localhost";
  return { id: url.hostname, origin: url.origin };
};

export const passkeysOf = (customerId: string) =>
  findBy<Passkey>("passkeys", "customerId", customerId);

function storeChallenge(challenge: Omit<Challenge, "id" | "expiresAt">): string {
  removeExpired("webauthn_challenges", nowSec());
  if (count("webauthn_challenges") >= CHALLENGES_MAX)
    throw new CustomerError(503, "temporarily_unavailable", "Too many sign-ins at once; retry");
  const id = newId("wch");
  put<Challenge>("webauthn_challenges", id, {
    ...challenge,
    id,
    expiresAt: nowSec() + CHALLENGE_TTL,
  });
  return id;
}

// Single use: the challenge is deleted before it is checked, so a replay finds nothing.
function takeChallenge(id: unknown, purpose: Challenge["purpose"]): Challenge {
  const challenge = typeof id === "string" ? get<Challenge>("webauthn_challenges", id) : undefined;
  if (challenge) remove("webauthn_challenges", challenge.id);
  if (!challenge || challenge.purpose !== purpose || challenge.expiresAt < nowSec())
    throw new CustomerError(401, "invalid_passkey", "This passkey request expired; start again");
  return challenge;
}

export async function registrationOptions(customer: Customer) {
  const existing = passkeysOf(customer.id);
  if (existing.length >= PASSKEYS_MAX)
    throw new CustomerError(409, "too_many_passkeys", `At most ${PASSKEYS_MAX} passkeys`);
  const options = await generateRegistrationOptions({
    rpName: "Atelier Velune",
    rpID: rp().id,
    userName: customer.email,
    userID: Buffer.from(customer.webauthnUserId, "base64url"),
    userDisplayName: customer.name,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = storeChallenge({
    challenge: options.challenge,
    purpose: "register",
    customerId: customer.id,
  });
  return { challengeId, options };
}

export async function verifyRegistration(customer: Customer, body: unknown) {
  const challenge = takeChallenge(isRecord(body) ? body.challengeId : undefined, "register");
  if (challenge.customerId !== customer.id)
    throw new CustomerError(401, "invalid_passkey", "This passkey request is not yours");
  const response = isRecord(body) ? body.response : undefined;
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().id,
      requireUserVerification: false,
    });
  } catch {
    throw new CustomerError(401, "invalid_passkey", "The passkey could not be verified");
  }
  if (!result.verified)
    throw new CustomerError(401, "invalid_passkey", "The passkey could not be verified");
  const { credential } = result.registrationInfo;
  if (get<Passkey>("passkeys", credential.id))
    throw new CustomerError(409, "passkey_exists", "This passkey is already registered");
  return put<Passkey>("passkeys", credential.id, {
    id: credential.id,
    customerId: customer.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports,
    createdAt: new Date().toISOString(),
  });
}

export async function loginOptions() {
  const options = await generateAuthenticationOptions({
    rpID: rp().id,
    userVerification: "preferred",
  });
  const challengeId = storeChallenge({ challenge: options.challenge, purpose: "login" });
  return { challengeId, options };
}

export async function verifyLogin(body: unknown) {
  const challenge = takeChallenge(isRecord(body) ? body.challengeId : undefined, "login");
  const { passkey, response } = passkeyOf(body);
  const customer = customerById(passkey?.customerId);
  if (!passkey || !customer)
    throw new CustomerError(401, "invalid_passkey", "This passkey is not registered here");
  await checkAssertion(challenge, passkey, response, false);
  return { customer, cookie: startSession(customer) };
}

function passkeyOf(body: unknown) {
  const response = isRecord(body) && isRecord(body.response) ? body.response : undefined;
  const passkey =
    typeof response?.id === "string" ? get<Passkey>("passkeys", response.id) : undefined;
  return { passkey, response };
}

async function checkAssertion(
  challenge: Challenge,
  passkey: Passkey,
  response: unknown,
  requireUserVerification: boolean,
) {
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    result = await verifyAuthenticationResponse({
      response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().id,
      credential: {
        id: passkey.id,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification,
    });
  } catch {
    throw new CustomerError(401, "invalid_passkey", "The passkey could not be verified");
  }
  if (!result.verified)
    throw new CustomerError(401, "invalid_passkey", "The passkey could not be verified");
  put("passkeys", passkey.id, {
    ...passkey,
    counter: result.authenticationInfo.newCounter,
    lastUsedAt: new Date().toISOString(),
  });
}

// --- step-up confirmation -----------------------------------------------------------------------

// A signed-in session is not enough to let an agent spend more (owner, 2026-11-18), nor to add a
// passkey that could later confirm that: the shopper proves it again with the account password or
// one of its own passkeys, verified on the device.
export async function confirmOptions(customer: Customer) {
  const passkeys = passkeysOf(customer.id);
  if (!passkeys.length)
    throw new CustomerError(409, "no_passkey", "This account has no passkey; use the password");
  const options = await generateAuthenticationOptions({
    rpID: rp().id,
    allowCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })),
    userVerification: "required",
  });
  const challengeId = storeChallenge({
    challenge: options.challenge,
    purpose: "confirm",
    customerId: customer.id,
  });
  return { challengeId, options };
}

export async function confirmIdentity(customer: Customer, confirm: unknown, address: string) {
  if (isRecord(confirm) && typeof confirm.password === "string") {
    // The sign-in limits apply: a stolen session must not become a way to guess the password.
    const keys = [`ip:${address}`, `email:${customer.email}`];
    refuseWhenLimited(keys.map((key) => [key, FAILURES_MAX]));
    for (const key of keys) countFailure(key);
    const valid = await Bun.password.verify(
      confirm.password.slice(0, PASSWORD_MAX),
      customer.passwordHash,
    );
    if (!valid) throw new CustomerError(401, "invalid_login", "Wrong password");
    for (const key of keys) uncountFailure(key);
    return "password" as const;
  }
  if (isRecord(confirm) && confirm.challengeId !== undefined) {
    const challenge = takeChallenge(confirm.challengeId, "confirm");
    if (challenge.customerId !== customer.id)
      throw new CustomerError(401, "invalid_passkey", "This passkey request is not yours");
    const { passkey, response } = passkeyOf(confirm);
    if (!passkey || passkey.customerId !== customer.id)
      throw new CustomerError(401, "invalid_passkey", "This passkey is not one of this account's");
    await checkAssertion(challenge, passkey, response, true);
    return "passkey" as const;
  }
  throw new CustomerError(
    401,
    "confirmation_required",
    "Confirm it is you with your password or a passkey",
  );
}

export function removePasskey(customer: Customer, id: string): boolean {
  const passkey = get<Passkey>("passkeys", id);
  if (!passkey || passkey.customerId !== customer.id) return false;
  remove("passkeys", id);
  return true;
}

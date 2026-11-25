// An in-process PAP agent for tests: it serves a client metadata document and JWKS on a loopback
// port, signs in through the real OAuth endpoints and calls the store through the same `handle`
// the route files use. Every token and JWT can be tampered with to probe a refusal.
// Spec: knowledge/components/adyen-agentic-commerce.md
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";
import { handle } from "../api";
import { forgetCardCache } from "../commerce/commerce";
import { customerFromCookies, forgetFailures } from "../accounts/customers";
import { openDatabase, useDatabase } from "../core/db";
import { forgetClientKeys, forgetCodeMisses } from "../oauth/oauth";
import { forgetProfiles } from "../ucp/profile";
import { sha256b64url } from "../core/util";
import { fake } from "./fake-adyen";

export const ORIGIN = "http://127.0.0.1:8003";
export const MCP = `${ORIGIN}/mcp`;
const now = () => Math.floor(Date.now() / 1000);
type Keys = Awaited<ReturnType<typeof generateKeyPair>>;

// Each test starts on an empty store, the default Adyen double and no cached cards.
export function freshStore() {
  // biome-ignore lint/correctness/useHookAtTopLevel: useDatabase swaps the store's database; it is not a React hook.
  useDatabase(openDatabase(":memory:"));
  fake.reset();
  forgetCardCache();
  forgetCodeMisses();
  forgetFailures();
  forgetProfiles();
  forgetClientKeys();
}

// A shopper account created through the browser API; its session cookie as a Cookie header.
export async function signUpCustomer(
  email = `shopper-${crypto.randomUUID().slice(0, 8)}@example.com`,
  ip = randomIp(),
): Promise<{ email: string; cookie: string }> {
  const response = await handle(
    new Request(`${ORIGIN}/api/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: "correct horse battery", name: "Test shopper" }),
    }),
  );
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (response.status !== 200 || !cookie) throw new Error(`sign-up answered ${response.status}`);
  return { email, cookie };
}

// The edge rate-limits per client IP and every in-process request would otherwise share one.
export const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export type SessionOptions = {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  omit?: string[];
  signer?: Keys;
  delegation?: string;
};

export class TestAgent {
  clientId = "";
  redirectUri = "";
  accessToken = "";
  refreshToken = "";
  scope = "";
  delegation = "";
  ip = randomIp();
  private server?: ReturnType<typeof Bun.serve>;
  private clientKeys!: Keys;
  private clientJwk!: JWK;
  // The algorithm of the client's published key: its assertions and delegations use it.
  clientAlg = "ES256";
  sessionKeys!: Keys;
  sessionKid = "";

  // grantTypes goes into client.json as grant_types; left out, the document has none, as before.
  // A public agent's document says it signs nothing (token_endpoint_auth_method "none").
  // `alg` is the client key's algorithm, ES256 unless a test plays another client.
  static async start(
    name = "Test agent",
    opts: { grantTypes?: string[]; public?: boolean; alg?: string } = {},
  ): Promise<TestAgent> {
    const agent = new TestAgent();
    agent.clientAlg = opts.alg ?? "ES256";
    await agent.rotateClientKey();
    agent.sessionKeys = await generateKeyPair("ES256", { extractable: true });
    agent.sessionKid = await calculateJwkThumbprint(await exportJWK(agent.sessionKeys.publicKey));
    const run = crypto.randomUUID().slice(0, 8);
    agent.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request): Response => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/client.json")) {
          return Response.json({
            client_id: agent.clientId,
            client_name: name,
            redirect_uris: [agent.redirectUri],
            jwks_uri: agent.clientId.replace("client.json", "jwks.json"),
            token_endpoint_auth_method: opts.public ? "none" : "private_key_jwt",
            ...(opts.grantTypes ? { grant_types: opts.grantTypes } : {}),
          });
        }
        if (path.endsWith("/jwks.json")) return Response.json({ keys: [agent.clientJwk] });
        return new Response("Not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${agent.server.port}/agent/${run}`;
    agent.clientId = `${base}/client.json`;
    agent.redirectUri = `${base}/callback`;
    return agent;
  }

  stop() {
    this.server?.stop(true);
  }

  // Starts an authorization request; returns the consent request id or the error redirect.
  async authorize(params: Record<string, string> = {}) {
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    const all = {
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state: "state-1",
      scope: "ucp:checkout ucp:pay ucp:orders profile",
      code_challenge: sha256b64url("verifier-verifier-verifier-verifier-0123456789"),
      code_challenge_method: "S256",
      ...params,
    };
    for (const [k, v] of Object.entries(all)) if (v !== "") url.searchParams.set(k, v);
    const response = await handle(new Request(url));
    const location = new URL(response.headers.get("location") ?? `${ORIGIN}/`, ORIGIN);
    return {
      response,
      location,
      requestId: location.pathname.startsWith("/consent/")
        ? location.pathname.split("/").pop()!
        : undefined,
    };
  }

  // The shopper's decision, posted as the consent form does, signed in as `customerCookie`
  // (an account is created when there is none in the current store) unless `cookie` is given;
  // "" posts it signed out.
  customerCookie = "";
  async decide(
    requestId: string,
    opts: { approve?: boolean; scopes?: string[]; spendLimitEur?: number; cookie?: string } = {},
  ) {
    if (opts.cookie === undefined && !customerFromCookies(this.customerCookie))
      this.customerCookie = (await signUpCustomer(undefined, this.ip)).cookie;
    const cookie = opts.cookie ?? this.customerCookie;
    const form = new URLSearchParams({
      request: requestId,
      decision: opts.approve === false ? "deny" : "approve",
      spend_limit_eur: String(opts.spendLimitEur ?? 150),
    });
    for (const s of opts.scopes ?? ["ucp:checkout", "ucp:pay", "ucp:orders", "profile"])
      form.append("scope", s);
    const response = await handle(
      new Request(`${ORIGIN}/oauth/decision`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
        body: form,
      }),
    );
    return new URL(response.headers.get("location") ?? `${ORIGIN}/`);
  }

  // `omit` drops registered claims (iat, jti, ...) to probe what the store requires.
  async assertion(
    claims: JWTPayload = {},
    signer: Keys = this.clientKeys,
    lifetime = 300,
    omit: string[] = [],
  ) {
    const issued = now();
    const payload: JWTPayload = {
      iss: this.clientId,
      sub: this.clientId,
      aud: ORIGIN,
      iat: issued,
      exp: issued + lifetime,
      jti: crypto.randomUUID(),
      ...claims,
    };
    for (const k of omit) delete payload[k];
    return new SignJWT(payload)
      .setProtectedHeader({ alg: this.clientAlg, kid: this.clientJwk.kid })
      .sign(signer.privateKey);
  }

  // A key pair the client never published, to sign what the store must refuse.
  static foreignKeys(): Promise<Keys> {
    return generateKeyPair("ES256", { extractable: true });
  }

  async token(form: Record<string, string>, assertion?: string) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion ?? (await this.assertion()),
      ...form,
    });
    const response = await handle(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "x-forwarded-for": this.ip },
        body,
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  }

  // A key rotation: jwks.json serves only a new key from now on, and the agent signs with it.
  async rotateClientKey() {
    this.clientKeys = await generateKeyPair(this.clientAlg, { extractable: true });
    this.clientJwk = {
      ...(await exportJWK(this.clientKeys.publicKey)),
      alg: this.clientAlg,
      use: "sig",
    };
    this.clientJwk.kid = await calculateJwkThumbprint(this.clientJwk);
  }

  // The happy path: consent with the given scopes and limit, then a token and a delegation.
  // `ask` is the scope parameter the agent sends; `scopes` is what the shopper ticks.
  async signIn(opts: { ask?: string; scopes?: string[]; spendLimitEur?: number } = {}) {
    const { requestId } = await this.authorize(opts.ask ? { scope: opts.ask } : {});
    if (!requestId) throw new Error("authorize did not reach consent");
    const back = await this.decide(requestId, opts);
    const code = back.searchParams.get("code");
    if (!code) throw new Error(`consent failed: ${back.href}`);
    const { status, body } = await this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: "verifier-verifier-verifier-verifier-0123456789",
    });
    if (status !== 200) throw new Error(`token failed: ${JSON.stringify(body)}`);
    this.accessToken = body.access_token!;
    this.refreshToken = body.refresh_token!;
    this.scope = body.scope!;
    this.delegation = await this.makeDelegation();
    return body;
  }

  async makeDelegation(
    opts: { lifetime?: number; iat?: number; signer?: Keys; typ?: string; cnf?: JWK } = {},
  ) {
    const iat = opts.iat ?? now();
    return new SignJWT({ cnf: { jwk: opts.cnf ?? (await exportJWK(this.sessionKeys.publicKey)) } })
      .setProtectedHeader({
        alg: this.clientAlg,
        typ: opts.typ ?? "poppy-delegation+jwt",
        kid: this.clientJwk.kid,
      })
      .setIssuer(this.clientId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + (opts.lifetime ?? 3600))
      .setJti(crypto.randomUUID())
      .sign((opts.signer ?? this.clientKeys).privateKey);
  }

  // PAP 1.0 §5.2: the delegation rides in the JWT header's poppy_dlg; aud is the issuer.
  // `omit` drops a claim, or poppy_dlg from the header.
  async session(url = MCP, method = "POST", opts: SessionOptions = {}) {
    const claims: Record<string, unknown> = {
      iss: this.clientId,
      sub: "demo-shopper",
      aud: ORIGIN,
      sid: "sid-1",
      htm: method,
      htu: url,
      iat: now(),
      jti: crypto.randomUUID(),
      ...(this.accessToken ? { ath: sha256b64url(this.accessToken) } : {}),
      ...opts.claims,
    };
    const omit = opts.omit ?? [];
    for (const k of omit) delete claims[k];
    return new SignJWT(claims as JWTPayload)
      .setProtectedHeader({
        alg: "ES256",
        typ: "poppy-session+jwt",
        kid: this.sessionKid,
        ...(omit.includes("poppy_dlg") ? {} : { poppy_dlg: opts.delegation ?? this.delegation }),
        ...opts.header,
      })
      .sign((opts.signer ?? this.sessionKeys).privateKey);
  }

  // One JSON-RPC call to /mcp with a fresh Poppy-Session unless the caller passes headers.
  async mcp(
    method: string,
    params: Record<string, unknown> = {},
    opts: {
      session?: SessionOptions;
      headers?: Record<string, string>;
      omitHeaders?: string[];
      token?: string | null;
    } = {},
  ) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "poppy-version": "1.0",
      "poppy-session": await this.session(MCP, "POST", opts.session),
      "x-forwarded-for": this.ip,
      ...opts.headers,
    };
    for (const h of opts.omitHeaders ?? []) delete headers[h];
    const token = opts.token === undefined ? this.accessToken : opts.token;
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await handle(
      new Request(MCP, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as Record<string, any>) : {},
    };
  }

  async tool(name: string, args: Record<string, unknown>) {
    const { status, body } = await this.mcp("tools/call", { name, arguments: args });
    if (status !== 200 || body.error) throw new Error(`${name}: ${status} ${JSON.stringify(body)}`);
    return {
      content: body.result.structuredContent as Record<string, any>,
      isError: body.result.isError as boolean | undefined,
    };
  }
}

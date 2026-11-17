// A minimal PAP 1.0 agent for local proof runs: it serves its own client metadata document and
// JWKS on a loopback port, signs in with OAuth (PKCE S256, private_key_jwt), then shops over MCP
// with a Poppy-Session on every call. The shopper approves on the consent page in a browser;
// --auto-consent posts that approval itself and works only while the store has no Back Office
// password, as on a local dev server. It never sees a card number or an Adyen token.
// Usage: bun scripts/pap-agent.ts [--origin http://127.0.0.1:8003] [--auto-consent] [--query scarf]
// Spec: knowledge/components/adyen-agentic-commerce.md
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

const arg = (name: string) => {
  const i = Bun.argv.indexOf(name);
  return i > 0 ? Bun.argv[i + 1] : undefined;
};
const origin = (arg("--origin") ?? "http://127.0.0.1:8003").replace(/\/+$/, "");
const autoConsent = Bun.argv.includes("--auto-consent");
const query = arg("--query") ?? "scarf";
const run = crypto.randomUUID().slice(0, 8);
const b64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");
const sha256 = async (text: string) =>
  b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const now = () => Math.floor(Date.now() / 1000);

// 1. Keys: one client key published in the JWKS, one session key bound by the delegation.
const clientKeys = await generateKeyPair("ES256", { extractable: true });
const clientJwk: JWK = { ...(await exportJWK(clientKeys.publicKey)), alg: "ES256", use: "sig" };
clientJwk.kid = await calculateJwkThumbprint(clientJwk);
const sessionKeys = await generateKeyPair("ES256", { extractable: true });
const sessionJwk = await exportJWK(sessionKeys.publicKey);
const sessionKid = await calculateJwkThumbprint(sessionJwk);

// 2. Client metadata document and JWKS on a loopback server; the callback receives the code.
let resolveCallback: (url: URL) => void = () => {};
const callback = new Promise<URL>((resolve) => (resolveCallback = resolve));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request): Response {
    const url = new URL(request.url);
    if (url.pathname === `/agent/${run}/client.json`) return Response.json(metadata());
    if (url.pathname === `/agent/${run}/jwks.json`) return Response.json({ keys: [clientJwk] });
    if (url.pathname === `/agent/${run}/callback`) {
      resolveCallback(url);
      return new Response("Signed in. You can close this tab and return to the agent.", {
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});
const base: string = `http://127.0.0.1:${server.port}/agent/${run}`;
const clientId: string = `${base}/client.json`;
const redirectUri = `${base}/callback`;
function metadata(): Record<string, unknown> {
  return {
    client_id: clientId,
    client_name: "Velune demo agent",
    client_uri: base,
    redirect_uris: [redirectUri],
    jwks_uri: `${base}/jwks.json`,
    token_endpoint_auth_method: "private_key_jwt",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

try {
  // 3. Discovery: poppy.json names the issuer and the MCP endpoint.
  const poppy = (await (await fetch(`${origin}/.well-known/poppy.json`)).json()) as {
    // PAP 1.0 §3.1: scope name -> description.
    auth: { issuer: string; scopes: Record<string, string> };
    apis: { type: string; url: string }[];
  };
  const issuer = poppy.auth.issuer;
  const mcpUrl = poppy.apis.find((a) => a.type === "mcp")!.url;
  const as = (await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
  };
  console.log("discovered", { issuer, mcpUrl });

  // 4. Authorization request with PKCE S256; the store answers with its consent page.
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const state = crypto.randomUUID();
  const authorize = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: Object.keys(poppy.auth.scopes).join(" "),
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    // RFC 8707, as MCP's authorization spec asks: the token is for the MCP endpoint only.
    resource: mcpUrl,
  }))
    authorize.searchParams.set(k, v);
  const consent = await fetch(authorize, { redirect: "manual" });
  const consentUrl = new URL(consent.headers.get("location") ?? "", origin);
  if (consent.status !== 302 || !consentUrl.pathname.startsWith("/consent/")) {
    throw new Error(`authorize answered ${consent.status}: ${await consent.text()}`);
  }

  // 5. The shopper decides; this run either waits for the browser or approves itself.
  if (autoConsent) {
    const form = new URLSearchParams({
      request: consentUrl.pathname.split("/").pop()!,
      decision: "approve",
      spend_limit_eur: "150",
    });
    for (const scope of Object.keys(poppy.auth.scopes)) form.append("scope", scope);
    const decided = await fetch(`${origin}/oauth/decision`, {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    const location = decided.headers.get("location");
    if (decided.status !== 303 || !location) throw new Error(`decision answered ${decided.status}`);
    resolveCallback(new URL(location));
  } else {
    console.log(`Shopper: open ${consentUrl.href} and choose Allow (waiting up to 5 minutes)`);
  }
  // A cleared timer, not Bun.sleep: a pending sleep kept the process alive five minutes after a
  // finished run.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const back = await Promise.race([
    callback,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("No consent within 5 minutes")), 300_000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (back.searchParams.get("error")) throw new Error(`consent: ${back.searchParams.get("error")}`);
  if (back.searchParams.get("state") !== state) throw new Error("state mismatch");
  if (back.searchParams.get("iss") !== issuer) throw new Error("iss mismatch");
  const code = back.searchParams.get("code")!;

  // 6. Token request, authenticated with a client assertion signed by the client key.
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: clientJwk.kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime(now() + 300)
    .setJti(crypto.randomUUID())
    .sign(clientKeys.privateKey);
  const tokenResponse = await fetch(as.token_endpoint, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: mcpUrl,
      client_id: clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });
  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };
  if (!tokens.access_token) throw new Error(`token: ${JSON.stringify(tokens)}`);
  console.log("signed in", { scope: tokens.scope });
  const ath = await sha256(tokens.access_token);

  // 7. Delegation: the client key vouches for the session key for one hour.
  const delegation = await new SignJWT({ cnf: { jwk: sessionJwk } })
    .setProtectedHeader({ alg: "ES256", typ: "poppy-delegation+jwt", kid: clientJwk.kid })
    .setIssuer(clientId)
    .setIssuedAt()
    .setExpirationTime(now() + 3600)
    .setJti(crypto.randomUUID())
    .sign(clientKeys.privateKey);
  const sid = crypto.randomUUID();

  // 8. Every MCP call carries a fresh Poppy-Session bound to the method, URL and token; its
  // delegation rides in the JWT header and its audience is the Company's issuer (PAP 1.0 §5.2).
  let rpcId = 0;
  async function mcp(method: string, params: Record<string, unknown>) {
    const session = await new SignJWT({ sid, htm: "POST", htu: mcpUrl, ath })
      .setProtectedHeader({
        alg: "ES256",
        typ: "poppy-session+jwt",
        kid: sessionKid,
        poppy_dlg: delegation,
      })
      .setIssuer(clientId)
      .setSubject("demo-shopper")
      .setAudience(issuer)
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(sessionKeys.privateKey);
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "poppy-version": "1.0",
        "poppy-session": session,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const body = (await response.json()) as {
      result?: { structuredContent?: Record<string, unknown>; isError?: boolean };
      error?: unknown;
    };
    if (response.status !== 200 || body.error)
      throw new Error(`${method} answered ${response.status}: ${JSON.stringify(body)}`);
    return body.result!;
  }
  const meta = () => ({ "idempotency-key": crypto.randomUUID() });

  await mcp("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "velune-demo-agent", version: "1.0.0" },
  });
  const search = (
    await mcp("tools/call", { name: "search_catalog", arguments: { catalog: { query } } })
  ).structuredContent as {
    products: {
      id: string;
      title: string;
      variants?: { id: string; availability?: { available?: boolean } }[];
    }[];
  };
  const product = search.products[0];
  if (!product) throw new Error(`No product for "${query}"`);
  const variant =
    product.variants?.find((v) => v.availability?.available !== false)?.id ?? product.id;
  console.log("chose", { product: product.title, variant });

  const created = (
    await mcp("tools/call", {
      name: "create_checkout",
      arguments: {
        meta: meta(),
        checkout: { line_items: [{ item: { id: variant }, quantity: 1 }] },
      },
    })
  ).structuredContent as {
    id: string;
    status: string;
    totals: { type: string; amount: number }[];
    messages?: unknown[];
    continue_url?: string;
    payment?: { instruments?: { id: string; handler_id: string; display?: unknown }[] };
  };
  const total = created.totals.find((t) => t.type === "total")?.amount;
  console.log("checkout", {
    id: created.id,
    status: created.status,
    total,
    messages: created.messages,
  });
  if (created.status !== "ready_for_complete")
    throw new Error(`Not ready: escalate to ${created.continue_url}`);
  const instrument = created.payment?.instruments?.[0];
  if (!instrument) throw new Error("No saved-card instrument offered");

  const completed = (
    await mcp("tools/call", {
      name: "complete_checkout",
      arguments: {
        meta: meta(),
        id: created.id,
        checkout: { payment: { instruments: [{ ...instrument, selected: true }] } },
      },
    })
  ).structuredContent as {
    status: string;
    order?: { id: string; permalink_url?: string };
    messages?: unknown[];
  };
  console.log("completed", {
    status: completed.status,
    order: completed.order,
    messages: completed.messages,
  });
  if (completed.status !== "completed") process.exitCode = 1;
} finally {
  server.stop(true);
}

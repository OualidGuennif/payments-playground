// A minimal PAP 1.0 agent for local proof runs: it serves its own client metadata document and
// JWKS on a loopback port, signs in with OAuth (PKCE S256, private_key_jwt), then shops over MCP
// with a Poppy-Session on every call. The shopper approves on the consent page in a browser;
// --auto-consent posts that approval itself and works only while the store has no Back Office
// password, as on a local dev server. Consent belongs to an account: with --email and
// PAP_SHOPPER_PASSWORD in the environment it signs in to that account (its saved cards pay);
// otherwise it creates a throwaway account with no card, so the payment escalates to the shopper.
// It never sees a card number or an Adyen token.
// With --code-mode it finds the product and builds the checkout in one `execute` call on /mcp/code
// (Code Mode: the agent's JavaScript runs in the store's sandbox), then pays on /mcp as before.
// Usage: bun scripts/pap-agent.ts [--origin http://127.0.0.1:8003] [--auto-consent] [--email a@b.c]
//        [--query scarf] [--code-mode]
// Spec: knowledge/components/adyen-agentic-commerce.md
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

const arg = (name: string) => {
  const i = Bun.argv.indexOf(name);
  return i > 0 ? Bun.argv[i + 1] : undefined;
};
const origin = (arg("--origin") ?? "http://127.0.0.1:8003").replace(/\/+$/, "");
const autoConsent = Bun.argv.includes("--auto-consent");
const query = arg("--query") ?? "scarf";
const codeMode = Bun.argv.includes("--code-mode");
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
    organization: { domain: string };
    // PAP 1.0 §3.1: scope name -> description.
    auth: { issuer: string; scopes: Record<string, string> };
    apis: { type: string; url: string }[];
  };
  // PAP 1.0 §3: the document speaks only for the host that served it.
  if (poppy.organization.domain !== new URL(origin).host)
    throw new Error(`poppy.json names ${poppy.organization.domain}, not ${new URL(origin).host}`);
  const issuer = poppy.auth.issuer;
  const mcpUrl = poppy.apis.find((a) => a.type === "mcp")!.url;
  const as = (await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    protected_resources?: string[];
  };
  if (as.issuer !== issuer) throw new Error(`the metadata names issuer ${as.issuer}`);
  // PAP 1.0 §3.2: a token is asked for a resource only when its issuer lists it.
  if (!as.protected_resources?.includes(mcpUrl))
    throw new Error(`${issuer} does not list ${mcpUrl} in protected_resources`);
  const codeUrl = `${mcpUrl}/code`;
  if (codeMode && !as.protected_resources.includes(codeUrl))
    throw new Error(`${issuer} does not list ${codeUrl} in protected_resources`);
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
    // No resource here: PAP 1.0 §4.5 makes a sign-in without one cover every resource, and the
    // token request below names the MCP URL (RFC 8707).
  }))
    authorize.searchParams.set(k, v);
  const consent = await fetch(authorize, { redirect: "manual" });
  const consentUrl = new URL(consent.headers.get("location") ?? "", origin);
  if (consent.status !== 302 || !consentUrl.pathname.startsWith("/consent/")) {
    throw new Error(`authorize answered ${consent.status}: ${await consent.text()}`);
  }

  // 5. The shopper decides; this run either waits for the browser or approves itself.
  if (autoConsent) {
    const email = arg("--email");
    const password = Bun.env.PAP_SHOPPER_PASSWORD;
    const account = await fetch(`${origin}/api/${email && password ? "session" : "customers"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        email && password
          ? { email, password }
          : { email: `pap-agent-${run}@example.com`, password: crypto.randomUUID(), name: run },
      ),
    });
    const cookie = account.headers.get("set-cookie")?.split(";")[0];
    if (account.status !== 200 || !cookie)
      throw new Error(`shopper sign-in answered ${account.status}`);
    const form = new URLSearchParams({
      request: consentUrl.pathname.split("/").pop()!,
      decision: "approve",
      spend_limit_eur: "150",
    });
    for (const scope of Object.keys(poppy.auth.scopes)) form.append("scope", scope);
    const decided = await fetch(`${origin}/oauth/decision`, {
      method: "POST",
      headers: { cookie },
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
  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: mcpUrl,
    client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  // One token good at both doors: RFC 8707 lets a token request name several resources.
  if (codeMode) tokenForm.append("resource", codeUrl);
  const tokenResponse = await fetch(as.token_endpoint, { method: "POST", body: tokenForm });
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
  async function mcp(method: string, params: Record<string, unknown>, url = mcpUrl) {
    const session = await new SignJWT({ sid, htm: "POST", htu: url, ath })
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
    const response = await fetch(url, {
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
  type Created = {
    id: string;
    status: string;
    totals: { type: string; amount: number }[];
    messages?: unknown[];
    continue_url?: string;
    payment?: { instruments?: { id: string; handler_id: string; display?: unknown }[] };
  };
  let created: Created;
  if (codeMode) {
    // The agent writes the whole lookup as code; only the checkout comes back.
    const code = `async () => {
      const { products = [] } = await codemode.search_catalog({ catalog: { query: ${JSON.stringify(query)} } });
      const product = products[0];
      if (!product) throw new Error("No product");
      const variant = product.variants?.find((v) => v.availability?.available !== false)?.id ?? product.id;
      console.log("chose", product.title, variant);
      return codemode.create_checkout({ checkout: { line_items: [{ item: { id: variant }, quantity: 1 }] } });
    }`;
    const ran = (await mcp("tools/call", { name: "execute", arguments: { code } }, codeUrl))
      .structuredContent as { result: Created; calls: unknown[]; logs: string[] };
    console.log("code mode", { calls: ran.calls, logs: ran.logs });
    created = ran.result;
  } else {
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

    created = (
      await mcp("tools/call", {
        name: "create_checkout",
        arguments: {
          meta: meta(),
          checkout: { line_items: [{ item: { id: variant }, quantity: 1 }] },
        },
      })
    ).structuredContent as Created;
  }
  const total = created.totals.find((t) => t.type === "total")?.amount;
  console.log("checkout", {
    id: created.id,
    status: created.status,
    total,
    messages: created.messages,
  });
  if (created.status !== "ready_for_complete")
    throw new Error(`Not ready: escalate to ${created.continue_url}`);
  // With no saved card on the account, completing with no instrument hands the checkout to the
  // shopper, who pays at continue_url.
  const instrument = created.payment?.instruments?.[0];
  const instruments = instrument ? [{ ...instrument, selected: true }] : [];

  const completed = (
    await mcp("tools/call", {
      name: "complete_checkout",
      arguments: { meta: meta(), id: created.id, checkout: { payment: { instruments } } },
    })
  ).structuredContent as {
    status: string;
    continue_url?: string;
    order?: { id: string; permalink_url?: string };
    messages?: unknown[];
  };
  console.log("completed", {
    status: completed.status,
    order: completed.order,
    continue_url: completed.continue_url,
    messages: completed.messages,
  });
  const handedOver = !instrument && completed.status === "requires_escalation";
  if (completed.status !== "completed" && !handedOver) process.exitCode = 1;
} finally {
  server.stop(true);
}

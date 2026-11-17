// A UCP platform for tests: it serves platform profiles on a loopback port, the good one every
// test sends in UCP-Agent and the broken ones the negotiation tests probe. It counts fetches.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { UCP_VERSION } from "../config";

const SHOPPING = [
  "dev.ucp.shopping.catalog.search",
  "dev.ucp.shopping.catalog.lookup",
  "dev.ucp.shopping.cart",
  "dev.ucp.shopping.checkout",
  "dev.ucp.shopping.order",
];

const capability = (name: string, version = UCP_VERSION, schemaHost = "ucp.dev") => [
  {
    version,
    spec: `https://ucp.dev/${version}/specification/`,
    schema: `https://${schemaHost}/${version}/schemas/${name}.json`,
  },
];

export function platformProfile(
  opts: { version?: string; names?: string[]; schemaHost?: Record<string, string> } = {},
) {
  const version = opts.version ?? UCP_VERSION;
  return {
    ucp: {
      version,
      services: {
        "dev.ucp.shopping": [
          {
            version,
            spec: `https://ucp.dev/${version}/specification/overview/`,
            transport: "rest",
            schema: `https://ucp.dev/${version}/services/shopping/rest.openapi.json`,
          },
        ],
      },
      capabilities: Object.fromEntries(
        (opts.names ?? SHOPPING).map((n) => [
          n,
          capability(n, version, opts.schemaHost?.[n] ?? "ucp.dev"),
        ]),
      ),
      payment_handlers: {},
    },
  };
}

const DOCS: Record<string, () => Response> = {
  "/profile.json": () =>
    Response.json(platformProfile(), { headers: { "cache-control": "public, max-age=60" } }),
  "/uncached.json": () =>
    Response.json(platformProfile(), { headers: { "cache-control": "no-store" } }),
  "/old.json": () => Response.json(platformProfile({ version: "2026-01-11" })),
  "/catalog-only.json": () =>
    Response.json(
      platformProfile({
        names: ["dev.ucp.shopping.catalog.search", "dev.ucp.shopping.catalog.lookup"],
      }),
    ),
  "/older-checkout.json": () => {
    const doc = platformProfile();
    doc.ucp.capabilities["dev.ucp.shopping.checkout"] = capability(
      "dev.ucp.shopping.checkout",
      "2026-01-11",
    );
    return Response.json(doc);
  },
  "/foreign-checkout.json": () =>
    Response.json(platformProfile({ schemaHost: { "dev.ucp.shopping.checkout": "evil.example" } })),
  "/redirect.json": () =>
    new Response(null, { status: 302, headers: { location: "/profile.json" } }),
  "/missing.json": () => new Response("Not found", { status: 404 }),
  "/not-json.json": () => new Response("<html>hello</html>", { status: 200 }),
  "/no-services.json": () => {
    const { services: _s, ...ucp } = platformProfile().ucp;
    return Response.json({ ucp });
  },
  "/bad-version.json": () => Response.json(platformProfile({ version: "draft" })),
  "/private-key.json": () =>
    Response.json({
      ...platformProfile(),
      keys: [{ kid: "k1", kty: "EC", crv: "P-256", x: "x", y: "y", d: "secret" }],
    }),
  "/huge.json": () => Response.json({ ...platformProfile(), padding: "x".repeat(300 * 1024) }),
  // Valid and just under 256 KiB: thousands of capability entries the store does not use.
  "/padded.json": () => {
    const doc = platformProfile();
    doc.ucp.capabilities["com.example.pad"] = Array.from({ length: 1700 }, (_, i) => ({
      version: "2026-08-25",
      spec: `https://example.com/pad/${i}/specification/`,
      schema: `https://example.com/pad/${i}/schemas/com.example.pad.json`,
    }));
    return Response.json(doc, { headers: { "cache-control": "public, max-age=3600" } });
  },
};

const fetched = new Map<string, number>();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    fetched.set(path, (fetched.get(path) ?? 0) + 1);
    return DOCS[path]?.() ?? new Response("Not found", { status: 404 });
  },
});
server.unref();

export const PLATFORM = `http://127.0.0.1:${server.port}`;
// The profile every ordinary test sends in UCP-Agent.
export const PROFILE = `${PLATFORM}/profile.json`;
export const ucpAgent = (url = PROFILE) => `profile="${url}"`;
export const fetchesOf = (path: string) => fetched.get(path) ?? 0;

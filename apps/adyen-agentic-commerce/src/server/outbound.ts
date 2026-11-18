// Spec: knowledge/components/adyen-agentic-commerce.md
// PAP 1.0 §3: the store never connects to a loopback, private or link-local address for a URL an
// agent gave it (client documents, jwks_uri, platform profiles). A name is resolved first and
// every address it gives must be public, since a fetch may use any of them.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { config } from "./config";

const LOOKUP_TIMEOUT_MS = 5000;

const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // this network, unspecified
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // shared address space (carrier-grade NAT)
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata services included
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const)
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64 reaches any IPv4 address, private ones included
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export class OutboundRefused extends Error {
  constructor(
    message: string,
    // "unresolved": the name gave no address in time; "not_public": an address is refused.
    readonly reason: "unresolved" | "not_public",
  ) {
    super(message);
  }
}

// Local runs and the tests serve agents on 127.0.0.1 next to a store on a loopback origin.
function loopbackStore(): boolean {
  const { protocol, hostname } = new URL(config().publicOrigin);
  return protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

// Why an address may not be reached, or undefined when it may. BlockList matches an IPv4-mapped
// IPv6 address (::ffff:a.b.c.d) against the IPv4 rules.
export function refusedAddress(
  address: string,
  allowLoopback = loopbackStore(),
): string | undefined {
  const family = isIP(address);
  if (!family) return "not an IP address";
  const type = family === 4 ? "ipv4" : "ipv6";
  if (allowLoopback && LOOPBACK.check(address, type)) return undefined;
  return NOT_PUBLIC.check(address, type) ? `${address} is not a public address` : undefined;
}

// Throws OutboundRefused unless every address the URL's host resolves to may be reached.
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string }[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw new OutboundRefused(`${url.host} does not resolve`, "unresolved");
  } finally {
    clearTimeout(timer);
  }
  if (!addresses.length) throw new OutboundRefused(`${url.host} does not resolve`, "unresolved");
  for (const { address } of addresses) {
    const why = refusedAddress(address);
    if (why) throw new OutboundRefused(`${url.host}: ${why}`, "not_public");
  }
}

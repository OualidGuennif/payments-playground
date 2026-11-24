// Spec: knowledge/components/adyen-agentic-commerce.md
// PAP 1.0 §3: no connection to a loopback, private or link-local address for a URL an agent gave.
import { describe, expect, test } from "bun:test";
import { assertPublicHost, OutboundRefused, refusedAddress } from "./outbound";

describe("outbound addresses", () => {
  test("private, link-local, shared, unspecified, multicast and unique-local addresses are refused", () => {
    for (const address of [
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::a00:1",
    ])
      expect([address, refusedAddress(address, true)]).toEqual([address, expect.any(String)]);
  });

  test("loopback is refused unless the store itself runs on loopback", () => {
    for (const address of ["127.0.0.1", "127.9.9.9", "::1", "::ffff:127.0.0.1"]) {
      expect(refusedAddress(address, false)).toBeString();
      expect(refusedAddress(address, true)).toBeUndefined();
    }
  });

  test("public addresses pass", () => {
    for (const address of ["93.184.216.34", "1.1.1.1", "172.32.0.1", "2606:4700::1111"])
      expect(refusedAddress(address, false)).toBeUndefined();
  });

  test("a host is checked by every address it resolves to", async () => {
    await expect(assertPublicHost(new URL("https://10.0.0.1/agent.json"))).rejects.toBeInstanceOf(
      OutboundRefused,
    );
    await expect(assertPublicHost(new URL("https://[fe80::1]/agent.json"))).rejects.toBeInstanceOf(
      OutboundRefused,
    );
    // The tests' store runs on 127.0.0.1, so loopback agents are allowed here.
    await expect(
      assertPublicHost(new URL("http://127.0.0.1:9/agent.json")),
    ).resolves.toBeUndefined();
    await expect(
      assertPublicHost(new URL("https://name.invalid/agent.json")),
    ).rejects.toBeInstanceOf(OutboundRefused);
  });
});

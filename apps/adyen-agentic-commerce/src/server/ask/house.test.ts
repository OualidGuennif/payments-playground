// Spec: knowledge/components/ask-agent.md
import { beforeEach, describe, expect, test } from "bun:test";
import { customerFromCookies } from "../accounts/customers";
import { handle } from "../api";
import { authenticate } from "../oauth/oauth";
import { grants } from "../oauth/tokens";
import { freshStore, ORIGIN, randomIp, signUpCustomer } from "../testing/agent";
import {
  connectInline,
  detachSession,
  disconnect,
  findActiveHouseGrant,
  forgetHouseConnections,
  HOUSE_CLIENT_NAME,
  houseClientId,
  houseGrantInfo,
  houseToken,
  pollConnect,
  resumeHouseConnection,
  startConnect,
} from "./house";

const SCOPES = [
  "dev.ucp.shopping.cart:manage",
  "dev.ucp.shopping.checkout:manage",
  "ucp:pay",
  "dev.ucp.shopping.order:read",
];
const LATER = 60_000;

beforeEach(() => {
  freshStore();
  forgetHouseConnections();
});

async function shopper() {
  const { cookie } = await signUpCustomer();
  const customer = customerFromCookies(cookie);
  if (!customer) throw new Error("no customer");
  return { cookie, id: customer.id };
}

// The shopper types the code at /device and decides on the ordinary consent page.
async function decide(userCode: string, cookie: string, approve = true) {
  const verified = await handle(
    new Request(`${ORIGIN}/oauth/device/verify`, {
      method: "POST",
      body: new URLSearchParams({ user_code: userCode }),
      headers: { cookie, "x-forwarded-for": randomIp() },
    }),
  );
  const location = new URL(verified.headers.get("location") ?? `${ORIGIN}/`);
  if (!location.pathname.startsWith("/consent/")) throw new Error(`no consent: ${location.href}`);
  const form = new URLSearchParams({
    request: location.pathname.split("/").pop() ?? "",
    decision: approve ? "approve" : "deny",
    spend_limit_eur: "150",
  });
  for (const scope of SCOPES) form.append("scope", scope);
  await handle(
    new Request(`${ORIGIN}/oauth/decision`, { method: "POST", body: form, headers: { cookie } }),
  );
}

describe("the house client", () => {
  test("is registered once and reused", () => {
    const id = houseClientId();
    expect(houseClientId()).toBe(id);
  });
});

describe("connecting a session to the shopper's account", () => {
  test("the shopper approves on the consent page; the grant is theirs, held in memory", async () => {
    const owner = await shopper();
    const t = Date.now();
    const started = await startConnect("ask_session_one", t);
    expect(started.userCode).toBeTruthy();
    await decide(started.userCode, owner.cookie);
    expect(await pollConnect("ask_session_one", owner.id, t + LATER)).toBe("connected");
    const token = houseToken("ask_session_one", t + LATER);
    expect(token).toBeDefined();
    const auth = authenticate(`Bearer ${token}`, "/mcp");
    if (!auth || auth === "invalid") throw new Error("token refused");
    expect(auth.grant.customerId).toBe(owner.id);
    expect(auth.grant.clientName).toBe(HOUSE_CLIENT_NAME);
  });

  test("the store is asked no faster than its interval", async () => {
    const owner = await shopper();
    const t = Date.now();
    const started = await startConnect("ask_session_two", t);
    await decide(started.userCode, owner.cookie);
    expect(await pollConnect("ask_session_two", owner.id, t + 1_000)).toBe("pending");
    expect(await pollConnect("ask_session_two", owner.id, t + LATER)).toBe("connected");
  });

  test("a code approved by another shopper is refused and that grant revoked", async () => {
    const owner = await shopper();
    const stranger = await shopper();
    const t = Date.now();
    const started = await startConnect("ask_session_three", t);
    await decide(started.userCode, stranger.cookie);
    expect(await pollConnect("ask_session_three", owner.id, t + LATER)).toBe("other_customer");
    expect(houseToken("ask_session_three", t + LATER)).toBeUndefined();
    const theirs = grants(stranger.id);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((g) => g.revoked)).toBe(true);
  });

  test("a denied request and an expired one end the attempt", async () => {
    const owner = await shopper();
    const t = Date.now();
    const denied = await startConnect("ask_session_four", t);
    await decide(denied.userCode, owner.cookie, false);
    expect(await pollConnect("ask_session_four", owner.id, t + LATER)).toBe("denied");
    expect(await pollConnect("ask_session_four", owner.id, t + LATER * 2)).toBe("none");
    const late = await startConnect("ask_session_five", t);
    expect(await pollConnect("ask_session_five", owner.id, t + late.expiresIn * 1000 + 1)).toBe(
      "expired",
    );
  });

  test("disconnecting forgets the token and ends the grant", async () => {
    const owner = await shopper();
    const t = Date.now();
    const started = await startConnect("ask_session_six", t);
    await decide(started.userCode, owner.cookie);
    expect(await pollConnect("ask_session_six", owner.id, t + LATER)).toBe("connected");
    const token = houseToken("ask_session_six", t + LATER);
    await disconnect("ask_session_six");
    expect(houseToken("ask_session_six", t + LATER)).toBeUndefined();
    const after = authenticate(`Bearer ${token}`, "/mcp");
    expect(after === undefined || after === "invalid").toBe(true);
    expect(grants(owner.id).every((g) => g.revoked)).toBe(true);
  });
});

// ADR-021: the grant is the account's; a conversation holds only a token minted for it.
describe("a durable house grant", () => {
  test("a resumed grant: a normal end keeps it, the next conversation takes it back", async () => {
    const owner = await shopper();
    expect(await connectInline("ask_session_a1", owner.id, 15_000)).toBe("connected");
    const first = houseToken("ask_session_a1");
    await detachSession("ask_session_a1");
    expect(houseToken("ask_session_a1")).toBeUndefined();
    const old = authenticate(`Bearer ${first}`, "/mcp");
    expect(old === undefined || old === "invalid").toBe(true);
    const grant = findActiveHouseGrant(owner.id);
    expect(grant).toMatchObject({ spendLimit: 15_000, revoked: false });
    // A restart forgets every token; the grant is still there to resume.
    forgetHouseConnections();
    expect(resumeHouseConnection("ask_session_a2", owner.id)).toBe(true);
    expect(houseGrantInfo("ask_session_a2")).toEqual({
      id: grant?.id ?? "",
      spendLimit: 15_000,
      spent: 0,
      remaining: 15_000,
    });
    const auth = authenticate(`Bearer ${houseToken("ask_session_a2")}`, "/mcp");
    if (!grant || !auth || auth === "invalid") throw new Error("no resumed grant");
    expect(auth.grant.id).toBe(grant.id);
    expect(resumeHouseConnection("ask_session_a3", "cus_nobody")).toBe(false);
  });

  test("one active grant: connect reuses it at its limit, a resume revokes older ones", async () => {
    const owner = await shopper();
    const t = Date.now();
    // Two grants from the device flow, as restarts before ADR-021 left them.
    for (const id of ["ask_session_b1", "ask_session_b2"]) {
      const started = await startConnect(id, t);
      await decide(started.userCode, owner.cookie);
      expect(await pollConnect(id, owner.id, t + LATER)).toBe("connected");
    }
    const house = () => grants(owner.id).filter((g) => g.clientId === houseClientId());
    expect(house().filter((g) => !g.revoked)).toHaveLength(2);
    forgetHouseConnections();
    expect(await connectInline("ask_session_b3", owner.id, 90_000)).toBe("connected");
    const live = house().filter((g) => !g.revoked);
    expect(live).toHaveLength(1);
    expect(live[0]?.spendLimit).not.toBe(90_000);
    expect(house()).toHaveLength(2);
  });

  test("a lock revokes the grant the conversation held", async () => {
    const owner = await shopper();
    expect(await connectInline("ask_session_c1", owner.id, 5_000)).toBe("connected");
    forgetHouseConnections();
    expect(resumeHouseConnection("ask_session_c2", owner.id)).toBe(true);
    await disconnect("ask_session_c2");
    expect(findActiveHouseGrant(owner.id)).toBeUndefined();
    expect(resumeHouseConnection("ask_session_c3", owner.id)).toBe(false);
  });
});

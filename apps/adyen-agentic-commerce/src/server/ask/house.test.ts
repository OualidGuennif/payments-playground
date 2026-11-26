// Spec: knowledge/components/ask-agent.md
import { beforeEach, describe, expect, test } from "bun:test";
import { customerFromCookies } from "../accounts/customers";
import { handle } from "../api";
import { authenticate } from "../oauth/oauth";
import { grants } from "../oauth/tokens";
import { freshStore, ORIGIN, randomIp, signUpCustomer } from "../testing/agent";
import {
  disconnect,
  forgetHouseConnections,
  HOUSE_CLIENT_NAME,
  houseClientId,
  houseToken,
  pollConnect,
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

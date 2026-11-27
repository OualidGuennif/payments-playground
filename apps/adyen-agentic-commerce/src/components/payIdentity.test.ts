// The Pay email modal's next step from the email check, failing closed (ADR-020).
// Spec: knowledge/components/agentic-storefront.md
import { describe, expect, test } from "bun:test";
import { type CheckFetch, checkEmail, welcomeSaving } from "./payIdentity";

const answering =
  (status: number, body?: unknown): CheckFetch =>
  async () =>
    new Response(body === undefined ? "" : JSON.stringify(body), { status });

describe("the Pay email modal's email check", () => {
  test("sends the header and the email only, and an answer picks sign-in or a new account", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const spy: CheckFetch = async (url, init) => {
      sent = { url, init };
      return new Response(JSON.stringify({ exists: true }), { status: 200 });
    };
    expect(await checkEmail("  ada@example.com ", spy)).toEqual({ step: "returning" });
    expect(sent?.url).toBe("/api/session/check-email");
    const init = sent?.init ?? {};
    expect((init.headers as Record<string, string>)["x-velune-check"]).toBe("1");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ada@example.com" });
    expect(await checkEmail("new@example.com", answering(200, { exists: false }))).toEqual({
      step: "new",
    });
  });

  test("a limit offers the other ways; anything unclear stays on the email with a reason", async () => {
    expect(await checkEmail("ada@example.com", answering(429))).toEqual({ step: "limited" });
    for (const fetcher of [
      answering(200, { exists: "yes" }),
      answering(200),
      answering(403, { error: "forbidden" }),
      answering(500),
      (async () => {
        throw new Error("offline");
      }) as CheckFetch,
    ]) {
      const next = await checkEmail("ada@example.com", fetcher);
      expect(next.step).toBe("email");
    }
    let called = false;
    const never: CheckFetch = async () => {
      called = true;
      return new Response("{}");
    };
    expect((await checkEmail("not an email", never)).step).toBe("email");
    expect((await checkEmail(`${"a".repeat(250)}@example.com`, never)).step).toBe("email");
    expect(called).toBe(false);
  });

  test("the saving shown is the server's: 5 % of the items, rounded to the cent", () => {
    expect([welcomeSaving(10000), welcomeSaving(1200), welcomeSaving(1990)]).toEqual([
      500, 60, 100,
    ]);
  });
});

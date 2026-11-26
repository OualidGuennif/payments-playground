// The store's one sign-in, used by /sign-in and the Ask panel's receipt block.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { describe, expect, test } from "bun:test";
import type { Answer } from "./answer";
import { type SignInCalls, signInWithPasskey, signInWithPassword } from "./signIn";

const ok = (data: unknown = {}): Answer => ({ data, error: null });
const customer = () => ok({ customer: { email: "a@example.com", name: "A" } });
const refused = (message: string): Answer => ({
  data: null,
  error: { value: { error: "invalid_login", message } },
});
const named = (name: string, message = "") => Object.assign(new Error(message), { name });

function fake(over: Partial<SignInCalls> = {}) {
  const seen: string[] = [];
  const calls: SignInCalls = {
    password: async (email) => {
      seen.push(`password:${email}`);
      return customer();
    },
    options: async () => {
      seen.push("options");
      return ok({ challengeId: "ch_1", options: { challenge: "abc" } });
    },
    authenticate: async (_options, autofill) => {
      seen.push(`authenticate:${autofill}`);
      return { id: "cred" } as Awaited<ReturnType<SignInCalls["authenticate"]>>;
    },
    verify: async (challengeId) => {
      seen.push(`verify:${challengeId}`);
      return customer();
    },
    ...over,
  };
  return { calls, seen };
}

describe("password", () => {
  test("signs in on the store's answer", async () => {
    const { calls, seen } = fake();
    expect(await signInWithPassword("a@example.com", "pw", calls)).toEqual({ signedIn: true });
    expect(seen).toEqual(["password:a@example.com"]);
  });

  test("shows the store's one message, the same for an unknown email and a wrong password", async () => {
    const { calls } = fake({ password: async () => refused("Wrong email or password.") });
    expect(await signInWithPassword("a@example.com", "pw", calls)).toEqual({
      signedIn: false,
      error: "Wrong email or password.",
    });
  });

  test("a 200 that names no customer is not a sign-in, for a password or a passkey", async () => {
    for (const data of [null, {}, "<html>proxy</html>", { customer: {} }]) {
      const password = fake({ password: async () => ok(data) });
      expect((await signInWithPassword("a@example.com", "pw", password.calls)).signedIn).toBe(
        false,
      );
      const passkey = fake({ verify: async () => ok(data) });
      expect((await signInWithPasskey(false, passkey.calls)).signedIn).toBe(false);
    }
  });

  test("an unreachable store is not a sign-in", async () => {
    const { calls } = fake({
      password: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const answer = await signInWithPassword("a@example.com", "pw", calls);
    expect(answer.signedIn).toBe(false);
  });
});

describe("passkey", () => {
  test("asks for options, the authenticator, then the store's verification", async () => {
    const { calls, seen } = fake();
    expect(await signInWithPasskey(false, calls)).toEqual({ signedIn: true });
    expect(seen).toEqual(["options", "authenticate:false", "verify:ch_1"]);
  });

  test("autofill asks the browser to offer the passkey from the email field", async () => {
    const { calls, seen } = fake();
    await signInWithPasskey(true, calls);
    expect(seen).toContain("authenticate:true");
  });

  test("an autofill offer no longer wanted when its options arrive never opens a prompt", async () => {
    const { calls, seen } = fake();
    expect(await signInWithPasskey(true, calls, () => false)).toEqual({ signedIn: false });
    expect(seen).toEqual(["options"]);
  });

  test("a cancelled or replaced prompt shows nothing", async () => {
    for (const name of ["NotAllowedError", "AbortError"]) {
      const { calls, seen } = fake({
        authenticate: async () => {
          throw named(name, "The operation either timed out or was not allowed.");
        },
      });
      expect(await signInWithPasskey(false, calls)).toEqual({ signedIn: false });
      expect(seen).not.toContain("verify:ch_1");
    }
  });

  test("a refused verification, unavailable options or a malformed answer is not a sign-in", async () => {
    const verify = fake({ verify: async () => refused("The passkey could not be verified.") });
    expect(await signInWithPasskey(false, verify.calls)).toEqual({
      signedIn: false,
      error: "The passkey could not be verified.",
    });
    const options = fake({ options: async () => refused("Please slow down a little.") });
    expect(await signInWithPasskey(false, options.calls)).toEqual({
      signedIn: false,
      error: "Please slow down a little.",
    });
    const malformed = fake({ options: async () => ok({ options: { challenge: "abc" } }) });
    expect((await signInWithPasskey(false, malformed.calls)).signedIn).toBe(false);
    expect(malformed.seen).not.toContain("authenticate:false");
  });

  test("another authenticator failure shows its message", async () => {
    const { calls } = fake({
      authenticate: async () => {
        throw named("SecurityError", "The RP ID is invalid for this domain.");
      },
    });
    expect(await signInWithPasskey(false, calls)).toEqual({
      signedIn: false,
      error: "The RP ID is invalid for this domain.",
    });
  });
});

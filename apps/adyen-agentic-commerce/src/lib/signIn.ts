// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
// One sign-in for every form of the store (the /sign-in page, the Ask panel's receipt block): both
// post to the store's own session and passkey routes, so the session cookie is set the same way and
// a wrong email reads exactly like a wrong password.
import { startAuthentication } from "@simplewebauthn/browser";
import { type Answer, messageOf } from "./answer";
import { api } from "./client";

type Options = Parameters<typeof startAuthentication>[0]["optionsJSON"];
type Assertion = Awaited<ReturnType<typeof startAuthentication>>;

/** The store's routes and the browser's authenticator; tests pass their own. */
export type SignInCalls = {
  password: (email: string, password: string) => Promise<Answer>;
  options: () => Promise<Answer>;
  verify: (challengeId: string, response: Assertion) => Promise<Answer>;
  authenticate: (optionsJSON: Options, autofill: boolean) => Promise<Assertion>;
};

/** Signed in, or not with what to tell the shopper; nothing to tell when they cancelled. */
export type SignIn = { signedIn: true } | { signedIn: false; error?: string };

const browserCalls = (): SignInCalls => ({
  password: (email, password) => api().session.post({ email, password }) as Promise<Answer>,
  options: () => api().passkeys.login.options.post() as Promise<Answer>,
  verify: (challengeId, response) =>
    api().passkeys.login.verify.post({ challengeId, response }) as Promise<Answer>,
  authenticate: (optionsJSON, autofill) =>
    startAuthentication({ optionsJSON, useBrowserAutofill: autofill }),
});

const UNREACHABLE = "The store could not be reached. Try again.";
const NO_PASSKEYS = "Passkeys are unavailable right now.";

export async function signInWithPassword(
  email: string,
  password: string,
  calls: SignInCalls = browserCalls(),
): Promise<SignIn> {
  try {
    const failed = messageOf(
      await calls.password(email, password),
      "Something went wrong. Try again.",
    );
    return failed ? { signedIn: false, error: failed } : { signedIn: true };
  } catch {
    return { signedIn: false, error: UNREACHABLE };
  }
}

/**
 * A passkey sign-in. With `autofill`, the browser offers the passkey among the email field's own
 * suggestions (its autocomplete ends in "webauthn") and the promise waits until one is picked.
 */
export async function signInWithPasskey(
  autofill = false,
  calls: SignInCalls = browserCalls(),
): Promise<SignIn> {
  try {
    const options = await calls.options();
    const failed = messageOf(options, NO_PASSKEYS);
    if (failed) return { signedIn: false, error: failed };
    const { challengeId, options: optionsJSON } = (options.data ?? {}) as {
      challengeId?: unknown;
      options?: Options;
    };
    if (typeof challengeId !== "string" || !optionsJSON)
      return { signedIn: false, error: NO_PASSKEYS };
    const response = await calls.authenticate(optionsJSON, autofill);
    const refused = messageOf(
      await calls.verify(challengeId, response),
      "The passkey could not be verified.",
    );
    return refused ? { signedIn: false, error: refused } : { signedIn: true };
  } catch (error) {
    // The shopper's own cancel, or a newer prompt replacing this one, needs no explanation.
    const name = (error as Error)?.name;
    if (name === "NotAllowedError" || name === "AbortError") return { signedIn: false };
    return { signedIn: false, error: (error as Error)?.message || UNREACHABLE };
  }
}

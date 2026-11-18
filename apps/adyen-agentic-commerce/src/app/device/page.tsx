// Spec: knowledge/components/adyen-agentic-commerce.md
// RFC 8628's verification page: the shopper types the code their agent showed, then sees the
// usual consent page. The code is checked by POST /oauth/device/verify, never here.

import { requireCustomer } from "@/lib/session";

export const metadata = { title: "Connect an agent with a code" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_code: "That code is unknown or expired. Check it, or ask your agent for a new one.",
  too_many_attempts: "Too many wrong codes. Wait ten minutes, then try again.",
};

export default async function Device({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string; error?: string; done?: string }>;
}) {
  const { user_code = "", error, done } = await searchParams;
  if (done === "approved" || done === "denied") {
    return (
      <div className="panel mx-auto max-w-lg space-y-3" role="status">
        <h1 className="text-2xl">{done === "approved" ? "Agent connected" : "Request declined"}</h1>
        <p className="text-sm text-muted">
          {done === "approved"
            ? "Go back to your agent: it gets access on its own within a few seconds. You can change its limit or disconnect it from your account at any time."
            : "Your agent gets no access. You can close this page."}
        </p>
      </div>
    );
  }
  // The code leads to consent, which needs an account: sign in first, keeping the typed code.
  const typed = user_code.replace(/[^A-Za-z-]/g, "").slice(0, 12);
  await requireCustomer(typed ? `/device?user_code=${typed}` : "/device");
  const message = error ? (ERRORS[error] ?? ERRORS.invalid_code) : undefined;
  return (
    <form method="post" action="/oauth/device/verify" className="panel mx-auto max-w-lg space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl">Connect an agent with a code</h1>
        <p className="text-sm text-muted">
          Type the 8-letter code your AI agent showed you. Next you will see what it asks to do, and
          you can allow or decline.
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor="user_code" className="block text-xs font-medium text-muted">
          Code
        </label>
        <input
          id="user_code"
          name="user_code"
          defaultValue={user_code.replace(/[^A-Za-z-]/g, "").slice(0, 12)}
          placeholder="BCDF-GHJK"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={12}
          aria-describedby={message ? "code-error code-warning" : "code-warning"}
          className="field font-mono text-lg tracking-widest uppercase"
        />
      </div>
      {message ? (
        <p id="code-error" role="alert" className="text-sm text-bad">
          {message}
        </p>
      ) : null}
      <p id="code-warning" className="text-xs text-muted">
        Only enter a code that your own agent showed you. A code sent by someone else would connect
        their agent to your account.
      </p>
      <button type="submit" className="btn w-full">
        Continue
      </button>
    </form>
  );
}

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
    const approved = done === "approved";
    return (
      <div className="panel mx-auto max-w-md space-y-3 text-center" role="status">
        <p
          aria-hidden="true"
          className={`mx-auto grid size-14 place-items-center rounded-2xl border-2 text-2xl ${
            approved ? "border-ok text-ok" : "border-line text-muted"
          }`}
        >
          {approved ? "✓" : "✕"}
        </p>
        <h1 className="text-xl">{approved ? "Agent connected" : "Request declined"}</h1>
        <p className="text-sm text-muted">
          {approved
            ? "Go back to your agent. It gets access on its own within a few seconds."
            : "Your agent gets no access. You can close this page."}
        </p>
        {approved ? (
          <a href="/account#agents" className="btn-ghost">
            Manage your agents
          </a>
        ) : null}
      </div>
    );
  }
  // The code leads to consent, which needs an account: sign in first, keeping the typed code.
  const typed = user_code.replace(/[^A-Za-z-]/g, "").slice(0, 12);
  await requireCustomer(typed ? `/device?user_code=${typed}` : "/device");
  const message = error ? (ERRORS[error] ?? ERRORS.invalid_code) : undefined;
  return (
    <form method="post" action="/oauth/device/verify" className="panel mx-auto max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl">Connect your agent</h1>
        <p className="text-sm text-muted">Type the code your agent showed you.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="user_code" className="block text-sm font-medium">
          Code
        </label>
        <input
          id="user_code"
          name="user_code"
          defaultValue={typed}
          placeholder="BCDF-GHJK"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={12}
          aria-describedby={message ? "code-error code-warning" : "code-warning"}
          className="field text-center font-mono text-xl tracking-[0.3em] uppercase"
        />
      </div>
      {message ? (
        <p id="code-error" role="alert" className="text-sm text-bad">
          {message}
        </p>
      ) : null}
      {/* A code someone else sent would connect their agent to this account (PAP 1.0 §10.8). */}
      <p id="code-warning" className="rounded-xl border border-warn px-3 py-2 text-sm">
        Only enter a code your own agent just showed you.
      </p>
      <button type="submit" className="btn w-full">
        Continue
      </button>
    </form>
  );
}

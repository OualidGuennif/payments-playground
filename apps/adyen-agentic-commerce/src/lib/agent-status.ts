// Spec: knowledge/components/adyen-agentic-commerce.md
// Where a connected agent stands, from three facts on its grant: the consent, the first token,
// the first authenticated request. A consent alone never reads as connected.

export type AgentFacts = {
  revoked: boolean;
  createdAt: string;
  tokenIssuedAt?: string;
  firstUsedAt?: string;
  lastUsedAt?: string;
};

export type AgentState = "disconnected" | "connected" | "token_issued" | "consented";

export function agentState(a: AgentFacts): AgentState {
  if (a.revoked) return "disconnected";
  // Grants from before the first-use date only have lastUsedAt; a request is a request.
  if (a.firstUsedAt ?? a.lastUsedAt) return "connected";
  if (a.tokenIssuedAt) return "token_issued";
  return "consented";
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const two = (n: number) => String(n).padStart(2, "0");

// Built by hand in UTC: Bun's and the browser's Intl join date and time differently, and the
// server's render and the browser's hydration must produce the same text in any time zone.
export function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

// One line saying what happened and what is missing, for the account page.
export function agentStory(a: AgentFacts): string {
  const first = a.firstUsedAt ?? a.lastUsedAt;
  switch (agentState(a)) {
    case "consented":
      return `You approved it on ${when(a.createdAt)}. It has not collected its access yet.`;
    case "token_issued":
      return `Access issued ${when(a.tokenIssuedAt!)}. It has not made a request yet.`;
    case "connected":
      return `First request ${when(first!)}, last ${when(a.lastUsedAt ?? first!)}.`;
    case "disconnected":
      return a.lastUsedAt
        ? `It can no longer act for you. Last request ${when(a.lastUsedAt)}.`
        : "It can no longer act for you.";
  }
}

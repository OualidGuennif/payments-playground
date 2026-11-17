// Spec: knowledge/components/adyen-agentic-commerce.md
const TONE: Record<string, string> = {
  completed: "border-ok text-ok",
  authorised: "border-ok text-ok",
  Authorised: "border-ok text-ok",
  ready_for_complete: "border-ok text-ok",
  requires_escalation: "border-warn text-warn",
  complete_in_progress: "border-warn text-warn",
  pending: "border-warn text-warn",
  incomplete: "border-warn text-warn",
  canceled: "border-bad text-bad",
  Refused: "border-bad text-bad",
  Error: "border-bad text-bad",
  // A connected agent (src/lib/agent-status.ts): only a request reads as success.
  connected: "border-ok text-ok",
  token_issued: "border-warn text-warn",
  consented: "border-warn text-warn",
  disconnected: "border-bad text-bad",
};

// UCP and Adyen names are protocol words; a shopper reads what they mean for them.
const LABEL: Record<string, string> = {
  ready_for_complete: "ready to pay",
  requires_escalation: "awaiting payment",
  complete_in_progress: "payment pending",
  incomplete: "details needed",
  open: "open",
  token_issued: "access issued",
  consented: "consent given",
};

// Unknown states stay neutral: they never read as success.
export function StatusPill({ status }: { status: string }) {
  const label = LABEL[status] ?? status.replaceAll("_", " ").toLowerCase();
  return (
    <span className={`pill ${TONE[status] ?? "border-line text-muted"}`} title={status}>
      {label}
    </span>
  );
}

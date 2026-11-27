"use client";
// Spec: knowledge/components/ask-agent.md
// The checkout card's overlays above the Personal Shopper (ADR-021): a card save in Drop-in, a
// budget to allow or to raise, and the chat-pay confirmation. Each uses the account's own routes
// and step-up; the panel reads the session and the checkout again once one is done.
import { useCallback, useEffect, useState } from "react";
import type { accountView } from "@/server/api";
import { AgentLimit } from "@/components/AgentLimit";
import { ChatOverlayModal } from "@/components/ChatOverlayModal";
import { DropinPanel, type SessionInfo } from "@/components/DropinPanel";
import { type Confirm, StepUp } from "@/components/StepUp";
import { api } from "@/lib/client";
import { askCall } from "./askClient";
import { AskConnect } from "./AskConnect";

type AccountView = Awaited<ReturnType<typeof accountView>>;
type Agent = AccountView["agents"][number];

const TEST_NOTE = <p className="text-xs text-muted">Adyen TEST: no real money moves.</p>;

export function ChatCardSaveModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState<string>();
  const createSession = useCallback(async (): Promise<SessionInfo> => {
    const { data, error } = await api().account["card-session"].post();
    if (error || !data || !("sessionData" in data))
      throw new Error("The card form could not be loaded.");
    return data as SessionInfo;
  }, []);
  const onFinished = useCallback(
    async (sessionId: string, sessionResult: string) => {
      const { data, error } = await api().account["card-result"].post({
        sessionId,
        sessionResult,
      });
      if (error || !data || !("account" in data)) {
        setNote("Adyen did not confirm the card yet. Try again in a moment.");
        return;
      }
      if (data.result === "completed") onSaved();
      else setNote(`Adyen answered: ${data.result}.`);
    },
    [onSaved],
  );
  return (
    <ChatOverlayModal title="Save a card" onClose={onClose}>
      <p className="text-sm text-muted">
        It is kept in your account on Adyen. Your Personal Shopper pays with it only within its
        budget, after you confirm the total.
      </p>
      <DropinPanel label="Save a card" createSession={createSession} onFinished={onFinished} />
      {note ? (
        <p role="status" className="text-sm">
          {note}
        </p>
      ) : null}
      {TEST_NOTE}
    </ChatOverlayModal>
  );
}

// Allow: the one-click connect with a budget. Raise: the account's own limit form and step-up, for
// the grant the conversation holds.
export function ChatBudgetModal({
  mode,
  grantId,
  onClose,
  onDone,
}: {
  mode: "connect" | "raise";
  grantId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [agent, setAgent] = useState<Agent>();
  const [webauthn, setWebauthn] = useState(false);
  const [problem, setProblem] = useState<string>();
  const raising = mode === "raise" && grantId !== undefined;

  useEffect(() => {
    if (!raising) return;
    let live = true;
    void api()
      .account.get()
      .then(({ data }) => {
        if (!live) return;
        const view = data as AccountView | null;
        const found = view?.agents?.find((a) => a.id === grantId && !a.revoked);
        if (!view || !found) {
          setProblem("This budget could not be read. Open your account to change it.");
          return;
        }
        setAgent(found);
        setWebauthn(view.passkeys.length > 0);
      });
    return () => {
      live = false;
    };
  }, [raising, grantId]);

  const changed = (view: AccountView) => {
    const after = view.agents.find((a) => a.id === grantId);
    if (!after || after.revoked || (agent && after.spendLimit > agent.spendLimit)) onDone();
    else setAgent(after);
  };

  return (
    <ChatOverlayModal
      title={raising ? "Raise the budget" : "Let your Personal Shopper pay"}
      onClose={onClose}
    >
      {raising ? (
        agent ? (
          <AgentLimit agent={agent} hasPasskey={webauthn} onChange={changed} />
        ) : (
          <p className="text-sm text-muted" role="status">
            {problem ?? "Reading your budget…"}
          </p>
        )
      ) : (
        <AskConnect onConnected={onDone} onCancel={onClose} />
      )}
      {TEST_NOTE}
    </ChatOverlayModal>
  );
}

// A chat payment with a saved card asks for the password or a passkey once an hour.
export function ChatStepUpModal({
  webauthn,
  onDone,
}: {
  webauthn: boolean;
  onDone: (confirmed: boolean) => void;
}) {
  const confirm = async (proof: Confirm): Promise<string | undefined> => {
    const answer = await askCall<{ confirmed: boolean }>("/confirm-pay", { confirm: proof });
    if (answer.data?.confirmed) {
      onDone(true);
      return undefined;
    }
    return answer.message ?? "That did not work. Try again.";
  };
  return (
    <ChatOverlayModal title="One check before paying" onClose={() => onDone(false)}>
      <StepUp
        bare
        prompt="To pay here with your saved card, the store asks for your password or a passkey once an hour."
        hasPasskey={webauthn}
        onConfirm={confirm}
        onCancel={() => onDone(false)}
      />
      {TEST_NOTE}
    </ChatOverlayModal>
  );
}

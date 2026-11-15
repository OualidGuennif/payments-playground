// The Adyen double for bun test: scripted stored cards and payment answers, and a record of every
// payment request so tests can assert what would have been sent.
// Spec: knowledge/components/adyen-agentic-commerce.md
import type { AgentPayment, StoredCard } from "../adyen";

type PaymentAnswer = { resultCode: string; pspReference?: string; refusalReason?: string } | Error;
type SessionAnswer = {
  status: string;
  reference?: string;
  payments: { resultCode: string; pspReference?: string; amount?: number }[];
};
const NO_PAYMENT: SessionAnswer = { status: "completed", payments: [] };

const VISA: StoredCard = {
  storedPaymentMethodId: "TEST_STORED_VISA_1111",
  brand: "visa",
  lastFour: "1111",
  expiryMonth: "03",
  expiryYear: "2030",
  models: ["CardOnFile", "UnscheduledCardOnFile"],
};

export const fake = {
  cards: [VISA] as StoredCard[],
  answers: [] as PaymentAnswer[],
  payments: [] as AgentPayment[],
  session: NO_PAYMENT,
  // Runs while the next payment call is in flight, before it answers.
  during: undefined as (() => void) | undefined,
  reset() {
    this.cards = [VISA];
    this.answers = [];
    this.payments = [];
    this.session = NO_PAYMENT;
    this.during = undefined;
  },
  answer(input: AgentPayment) {
    this.payments.push(input);
    const during = this.during;
    this.during = undefined;
    during?.();
    const next = this.answers.shift() ?? {
      resultCode: "Authorised",
      pspReference: `PSP${this.payments.length}`,
    };
    if (next instanceof Error) throw next;
    return { refusalReasonCode: undefined, ...next };
  },
};

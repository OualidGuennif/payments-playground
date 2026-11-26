// The Adyen double for bun test: scripted stored cards, card brands and payment answers, and a
// record of every payment request so tests can assert what would have been sent.
// Spec: knowledge/components/adyen-agentic-commerce.md
import type {
  AgentPayment,
  NetworkTokenPayment,
  SessionRequest,
  StoredCard,
} from "../payments/adyen";

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
  payments: [] as (AgentPayment | NetworkTokenPayment)[],
  // The shopperReference of every stored-card lookup and every Drop-in session request.
  lookups: [] as string[],
  sessions: [] as SessionRequest[],
  session: NO_PAYMENT,
  // The numbers sent to /cardDetails, and the brand (or failure) it answers.
  brandLookups: [] as string[],
  brand: "visa" as string | undefined | Error,
  // Run while the next payment call is in flight, before it answers; `settle` is awaited there,
  // and in the next session result call.
  during: undefined as (() => void) | undefined,
  settle: undefined as (() => Promise<unknown>) | undefined,
  reset() {
    this.cards = [VISA];
    this.answers = [];
    this.payments = [];
    this.lookups = [];
    this.sessions = [];
    this.session = NO_PAYMENT;
    this.brandLookups = [];
    this.brand = "visa";
    this.during = undefined;
    this.settle = undefined;
  },
  cardBrand(number: string) {
    this.brandLookups.push(number);
    if (this.brand instanceof Error) throw this.brand;
    return this.brand;
  },
  answer(input: AgentPayment | NetworkTokenPayment) {
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

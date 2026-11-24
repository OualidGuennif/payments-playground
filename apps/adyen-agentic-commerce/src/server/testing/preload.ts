// Runs before every test file: fixed TEST-shaped settings (overriding anything Bun loaded from the
// app's env file) and the Adyen module replaced by the scripted double, so no test reaches Adyen.
// Spec: knowledge/components/adyen-agentic-commerce.md
import { mock } from "bun:test";

Object.assign(process.env, {
  PUBLIC_ORIGIN: "http://127.0.0.1:8003",
  ADYEN_ENVIRONMENT: "TEST",
  ADYEN_API_KEY: "fake-api-key-for-tests",
  ADYEN_MERCHANT_ACCOUNT: "FakeMerchantECOM",
  ADYEN_CLIENT_KEY: "test_FAKECLIENTKEYFORTESTS",
  ADYEN_HMAC_KEY: "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF",
  DATABASE_PATH: ":memory:",
  PLAYGROUND_BASIC_AUTH_USER: "",
  PLAYGROUND_BASIC_AUTH_PASSWORD: "",
});

const real = await import("../payments/adyen");
const { fake } = await import("./fake-adyen");
mock.module("../payments/adyen", () => ({
  ...real,
  storedCards: async (shopperReference: string) => {
    fake.lookups.push(shopperReference);
    return fake.cards;
  },
  payWithSavedCard: async (input: Parameters<typeof real.payWithSavedCard>[0]) =>
    fake.answer(input),
  cardBrand: async (number: string) => fake.cardBrand(number),
  payWithNetworkToken: async (input: Parameters<typeof real.payWithNetworkToken>[0]) =>
    fake.answer(input),
  createSession: async (input: Parameters<typeof real.createSession>[0]) => {
    fake.sessions.push(input);
    return { id: `CS_${input.reference}`, sessionData: "fake" };
  },
  sessionResult: async () => fake.session,
  forgetCard: async (id: string) => {
    fake.cards = fake.cards.filter((c) => c.storedPaymentMethodId !== id);
  },
}));

// Spec: knowledge/components/ask-agent.md
// The Ask agent's tests share one Flue runtime per process (Flue keeps one), started on Pi's faux
// provider registered under the name "openai", so models resolve as in production and no test
// needs a key or reaches a provider.
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { AGENT_VERSION, askRuntime } from "../ask/agent";
import { readAskConfig } from "../ask/config";
import { startSession } from "../ask/sessions";

const PRICES = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 };
export const faux = fauxProvider({
  provider: "openai",
  models: [
    { id: "faux-answer", reasoning: true, cost: PRICES, contextWindow: 200_000, maxTokens: 4_096 },
    { id: "faux-guard", reasoning: true, cost: PRICES, contextWindow: 32_000, maxTokens: 1_024 },
  ],
});
export const fauxModels = createModels();
fauxModels.setProvider(faux.provider);
export const ANSWER_MODEL = "openai/faux-answer";
export const GUARD_MODEL = "openai/faux-guard";

export const startFauxRuntime = () => askRuntime([faux.provider]);

export const askLimits = () => readAskConfig({}).limits;

export function askSession(customerId?: string) {
  return startSession({
    address: "10.1.2.3",
    limits: askLimits(),
    answer: { model: ANSWER_MODEL, effort: "low" },
    guard: { model: GUARD_MODEL, effort: "minimal" },
    agentVersion: AGENT_VERSION,
    customer: customerId
      ? ({ id: customerId } as Parameters<typeof startSession>[0]["customer"])
      : undefined,
  });
}

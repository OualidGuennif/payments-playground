// Spec: knowledge/components/ask-agent.md
// The Ask agent's tests share one Flue runtime per process (Flue keeps one), started on Pi's faux
// provider registered under the name "openai", so models resolve as in production and no test
// needs a key or reaches a provider.
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { handle } from "../api";
import { AGENT_VERSION, askRuntime } from "../ask/agent";
import { readAskConfig } from "../ask/config";
import { startSession } from "../ask/sessions";
import { ORIGIN, randomIp, signUpCustomer } from "./agent";

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

// One browser: its cookies, its address, and the panel's header on every POST.
export class Browser {
  cookies = new Map<string, string>();
  ip = randomIp();

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const sent: Record<string, string> = { "x-forwarded-for": this.ip, ...headers };
    if (method !== "GET" && !("x-ask" in sent)) sent["x-ask"] = "1";
    if (this.cookies.size) sent.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) sent["content-type"] = "application/json";
    const response = await handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: sent,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    for (const line of response.headers.getSetCookie()) this.keep(line.split(";")[0] ?? "");
    return response;
  }

  keep(pair: string) {
    const [name, ...rest] = pair.split("=");
    const value = rest.join("=");
    if (!name) return;
    if (value) this.cookies.set(name.trim(), value);
    else this.cookies.delete(name.trim());
  }

  async signUp() {
    const { cookie } = await signUpCustomer(undefined, this.ip);
    this.keep(cookie);
    return cookie;
  }

  view = async () =>
    (await (await this.call("GET", "/api/ask/session")).json()) as Record<string, any>;
}

export type Streamed = { type: string; data: Record<string, any> };
export async function streamed(response: Response): Promise<Streamed[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim())
    .map((block) => ({
      type: /^event: (.+)$/m.exec(block)?.[1] ?? "",
      data: JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "{}"),
    }));
}

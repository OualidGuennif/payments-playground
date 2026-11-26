// Spec: knowledge/components/ask-agent.md
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createModels, type Provider } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { freshStore } from "../testing/agent";
import { askSession, faux, startFauxRuntime } from "../testing/ask";
import { houseAgentRunner } from "./agent";
import { parseModel, readAskConfig } from "./config";
import {
  admitModelOperation,
  announceModelRequest,
  cleanKeys,
  closeMeter,
  keyedProviders,
  ModelCallRefused,
  meterTurn,
  openMeter,
  withoutClientRetries,
} from "./runtime";

describe("provider keys", () => {
  // A Pi upgrade that drops a default model from its catalog would leave the guard unavailable
  // (fail closed) and the answer model unknown, so the bump has to show they are still listed.
  test("Pi's catalog still lists the default answer and guard models", () => {
    const models = createModels();
    for (const provider of keyedProviders({ OPENAI_API_KEY: "sk-test-catalog" }))
      models.setProvider(provider);
    const { answer, guard } = readAskConfig({});
    for (const choice of [answer, guard]) {
      const parsed = parseModel(choice.model);
      expect(parsed && models.getModel(parsed.provider, parsed.id)).toBeDefined();
    }
  });

  test("a key pasted with quotes or a newline is cleaned; an empty one is unset", () => {
    const env: Record<string, string | undefined> = {
      OPENAI_API_KEY: ' "sk-test-1"\n',
      ANTHROPIC_API_KEY: "   ",
      MISTRAL_API_KEY: "'mi-test-2'",
      OTHER_SETTING: " kept as is ",
    };
    cleanKeys(env);
    expect(env.OPENAI_API_KEY).toBe("sk-test-1");
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect(env.MISTRAL_API_KEY).toBe("mi-test-2");
    expect(env.OTHER_SETTING).toBe(" kept as is ");
  });

  test("only providers with a key are registered", () => {
    const ids = keyedProviders({ OPENAI_API_KEY: "x", DEEPSEEK_API_KEY: "y" }).map((p) => p.id);
    expect(ids).toEqual(["openai", "deepseek"]);
    expect(keyedProviders({})).toEqual([]);
  });
});

describe("the model call meter", () => {
  const ID = "ask_meter_test";
  afterEach(() => {
    closeMeter(ID);
  });

  test("with no open meter nothing reaches a provider", () => {
    announceModelRequest(ID);
    expect(admitModelOperation(ID)).toBeInstanceOf(ModelCallRefused);
    expect(admitModelOperation(undefined)).toBeInstanceOf(ModelCallRefused);
  });

  test("each announced request counts once; reads of its stream pass; the cap refuses", () => {
    const meter = openMeter(ID, 2);
    announceModelRequest(ID);
    expect(admitModelOperation(ID)).toBeUndefined();
    expect(admitModelOperation(ID)).toBeUndefined();
    expect(admitModelOperation(ID)).toBeUndefined();
    expect(meter.calls).toBe(1);
    announceModelRequest(ID);
    expect(admitModelOperation(ID)).toBeUndefined();
    expect(meter.calls).toBe(2);
    announceModelRequest(ID);
    expect(admitModelOperation(ID)).toBeInstanceOf(ModelCallRefused);
    expect(meter.capped).toBe(true);
    expect(meter.calls).toBe(2);
  });

  test("usage and cost add up over the message's calls", () => {
    const meter = openMeter(ID, 5);
    const turn = {
      instanceId: ID,
      response: {
        usage: {
          input: 10,
          output: 4,
          cacheRead: 100,
          cacheWrite: 0,
          totalTokens: 114,
          cost: { total: 0.01 },
        },
      },
    } as unknown as Parameters<typeof meterTurn>[0];
    meterTurn(turn);
    meterTurn(turn);
    expect(meter.usage).toEqual({ input: 20, output: 8, cacheRead: 200, cacheWrite: 0 });
    expect(meter.costUsd).toBeCloseTo(0.02);
  });
});

describe("retries", () => {
  test("the SDK's own retries are off for every call", () => {
    const seen: unknown[] = [];
    const record = (_model: unknown, _context: unknown, options?: unknown) => {
      seen.push(options);
      return "stream";
    };
    const provider = {
      id: "openai",
      name: "OpenAI",
      stream: record,
      streamSimple: record,
      getModels: () => [],
    } as unknown as Provider;
    const wrapped = withoutClientRetries(provider) as unknown as {
      id: string;
      stream: typeof record;
      streamSimple: typeof record;
      getModels: () => unknown[];
    };
    wrapped.stream({}, {}, { maxRetries: 2, sessionId: "aff_1" });
    wrapped.streamSimple({}, {});
    expect(seen).toEqual([{ maxRetries: 0, sessionId: "aff_1" }, { maxRetries: 0 }]);
    expect(wrapped.id).toBe("openai");
    expect(wrapped.getModels()).toEqual([]);
  });

  describe("Flue's own retry of a transient error", () => {
    beforeAll(async () => {
      await startFauxRuntime();
    });
    beforeEach(() => {
      freshStore();
      faux.setResponses([]);
    });
    const failure = () =>
      fauxAssistantMessage(fauxText(""), {
        stopReason: "error",
        errorMessage: "503 service unavailable",
      });
    const message = "<shopper_message>\nhello\n</shopper_message>";

    test("is a counted call", async () => {
      faux.setResponses([failure(), fauxAssistantMessage(fauxText("Back again."))]);
      const { session } = askSession();
      const before = faux.state.callCount;
      const outcome = await houseAgentRunner(6)({
        session,
        message,
        mode: "normal",
        onTool: () => undefined,
      });
      expect(faux.state.callCount - before).toBe(2);
      expect(outcome.calls).toBe(2);
      expect(outcome.ok).toBe(true);
    });

    test("is refused at the cap", async () => {
      faux.setResponses([failure(), fauxAssistantMessage(fauxText("Back again."))]);
      const { session } = askSession();
      const before = faux.state.callCount;
      const outcome = await houseAgentRunner(1)({
        session,
        message,
        mode: "normal",
        onTool: () => undefined,
      });
      expect(faux.state.callCount - before).toBe(1);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("model_call_cap");
    });
  });
});

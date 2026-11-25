// Spec: knowledge/components/ask-agent.md
import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { openDatabase, useDatabase } from "../core/db";
import { CONSOLE_PASSWORD_MIN, parseModel, readAskConfig, usable } from "./config";
import {
  auditLines,
  describeSettings,
  effectiveSettings,
  SettingsError,
  saveSettings,
} from "./settings";

const KEY = "sk-test-not-a-real-key-123456";
const PASSWORD = "a-console-password-long-enough";

beforeEach(() => {
  useDatabase(openDatabase(":memory:") as Database);
});

describe("ask config", () => {
  test("keys are read as present or absent, never kept", () => {
    const config = readAskConfig({ OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: "  " });
    expect(config.keys).toEqual({
      openai: true,
      anthropic: false,
      mistral: false,
      deepseek: false,
    });
    expect(JSON.stringify(config)).not.toContain(KEY);
  });

  test("keys never serialized in what the console shows", () => {
    const config = readAskConfig({ OPENAI_API_KEY: KEY, CONSOLE_PASSWORD: PASSWORD });
    const shown = JSON.stringify(describeSettings(config));
    expect(shown).not.toContain(KEY);
    expect(shown).not.toContain(PASSWORD);
    expect(shown).toContain('"keySet":true');
  });

  test("a quoted dotenv value is cleaned like the store's other variables", () => {
    const config = readAskConfig({
      OPENAI_API_KEY: `"${KEY}"`,
      ASK_AGENT_MODEL: '"openai/gpt-5.4-mini"',
    });
    expect(config.keys.openai).toBe(true);
    expect(config.answer.model).toBe("openai/gpt-5.4-mini");
  });

  test("an unknown provider, a malformed model or effort falls back to the default", () => {
    const config = readAskConfig({ ASK_AGENT_MODEL: "litellm/gpt", ASK_AGENT_EFFORT: "turbo" });
    expect(config.answer).toEqual({ model: "openai/gpt-6.2-sol", effort: "low" });
    expect(parseModel("openai/../../x")).toBeUndefined();
    expect(parseModel("anthropic/claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      id: "claude-sonnet-5-5",
    });
  });

  test("a limit out of range is clamped, a typo keeps the default", () => {
    const config = readAskConfig({ ASK_MAX_MODEL_CALLS: "500", ASK_DAILY_BUDGET_USD: "five" });
    expect(config.limits.maxModelCalls).toBe(12);
    expect(config.limits.dailyBudgetUsd).toBe(5);
  });

  test(`a console password under ${CONSOLE_PASSWORD_MIN} characters disables the console`, () => {
    expect(readAskConfig({ CONSOLE_PASSWORD: "short" }).consolePassword).toBeUndefined();
    expect(readAskConfig({ CONSOLE_PASSWORD: PASSWORD }).consolePassword).toBe(PASSWORD);
  });

  test("disabled is safe: no key, no usable model", () => {
    const config = readAskConfig({});
    expect(usable(config.answer.model, config.keys)).toBe(false);
    expect(effectiveSettings(config).answer).toBeUndefined();
    expect(effectiveSettings(config).guard).toBeUndefined();
  });

  test("ASK_AGENT_ENABLED=false switches the agent off", () => {
    expect(readAskConfig({ ASK_AGENT_ENABLED: "false" }).enabled).toBe(false);
    expect(readAskConfig({}).enabled).toBe(true);
  });
});

describe("ask settings", () => {
  const config = readAskConfig({ OPENAI_API_KEY: KEY, MISTRAL_API_KEY: KEY });

  test("a saved model overrides the default and leaves an audit line", () => {
    const after = saveSettings(config, {
      answer: { model: "mistral/mistral-medium-latest", effort: "medium" },
    });
    expect(after.answer).toEqual({ model: "mistral/mistral-medium-latest", effort: "medium" });
    const [line] = auditLines();
    expect(line?.field).toBe("answer");
    expect(line?.to).toEqual({ model: "mistral/mistral-medium-latest", effort: "medium" });
  });

  test("a model whose provider has no key is refused", () => {
    expect(() =>
      saveSettings(config, { answer: { model: "anthropic/claude-sonnet-5-5", effort: "low" } }),
    ).toThrow(SettingsError);
    expect(auditLines()).toHaveLength(0);
  });

  test("a stored model whose key was removed is ignored", () => {
    saveSettings(config, { answer: { model: "mistral/mistral-medium-latest", effort: "low" } });
    const withoutMistral = readAskConfig({ OPENAI_API_KEY: KEY });
    expect(effectiveSettings(withoutMistral).answer?.model).toBe("openai/gpt-6.2-sol");
  });

  test("a limit outside its range is refused and nothing is written", () => {
    expect(() =>
      saveSettings(config, { limits: { sessionMinutes: 30, maxModelCalls: 99 } }),
    ).toThrow(SettingsError);
    expect(effectiveSettings(config).limits.maxModelCalls).toBe(6);
    expect(auditLines()).toHaveLength(0);
  });

  test("limits within range are saved", () => {
    const after = saveSettings(config, { limits: { sessionMinutes: 20 }, voiceEnabled: false });
    expect(after.limits.sessionMinutes).toBe(20);
    expect(after.voiceEnabled).toBe(false);
    expect(
      auditLines()
        .map((l) => l.field)
        .sort(),
    ).toEqual(["limits.sessionMinutes", "voiceEnabled"]);
  });
});

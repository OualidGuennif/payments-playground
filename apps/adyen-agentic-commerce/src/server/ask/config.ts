// Spec: knowledge/components/ask-agent.md
// The Ask agent's environment, read once. Keys are reported as present or absent and nothing more:
// no value, model id or effort from here may reach a browser (spec invariant 1).
import { cleanEnvValue as clean } from "../core/config";

export const PROVIDERS = ["openai", "anthropic", "mistral", "deepseek"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const KEY_VARS: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

export const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type ModelChoice = { model: string; effort: Effort };

export type AskLimits = {
  sessionMinutes: number;
  idleMinutes: number;
  maxMessages: number;
  maxModelCalls: number;
  sessionBudgetUsd: number;
  dailyBudgetUsd: number;
  voiceMinutes: number;
  voiceDailyMinutes: number;
};

// Each limit's default and the range the console may set it in: a typo in a variable or a form
// falls back to the default instead of lifting a cap.
export const LIMIT_RANGES: Record<
  keyof AskLimits,
  { env: string; def: number; min: number; max: number }
> = {
  sessionMinutes: { env: "ASK_SESSION_MAX_MINUTES", def: 30, min: 5, max: 120 },
  idleMinutes: { env: "ASK_SESSION_IDLE_MINUTES", def: 10, min: 2, max: 60 },
  maxMessages: { env: "ASK_SESSION_MAX_MESSAGES", def: 40, min: 5, max: 200 },
  maxModelCalls: { env: "ASK_MAX_MODEL_CALLS", def: 6, min: 2, max: 12 },
  sessionBudgetUsd: { env: "ASK_SESSION_BUDGET_USD", def: 0.5, min: 0.05, max: 5 },
  dailyBudgetUsd: { env: "ASK_DAILY_BUDGET_USD", def: 5, min: 0.5, max: 100 },
  voiceMinutes: { env: "ASK_VOICE_MAX_MINUTES", def: 10, min: 1, max: 20 },
  voiceDailyMinutes: { env: "ASK_VOICE_DAILY_MINUTES", def: 30, min: 1, max: 240 },
};

export type AskConfig = {
  enabled: boolean;
  keys: Record<Provider, boolean>;
  answer: ModelChoice;
  guard: ModelChoice;
  voice: { enabled: boolean; model: string };
  limits: AskLimits;
  consolePassword?: string;
  voicePassword?: string;
};

export const CONSOLE_PASSWORD_MIN = 16;

const DEFAULT_ANSWER: ModelChoice = { model: "openai/gpt-6.2-sol", effort: "low" };
const DEFAULT_GUARD: ModelChoice = { model: "openai/gpt-5.4-mini", effort: "minimal" };
const DEFAULT_VOICE_MODEL = "gpt-live-1.1";

// "provider/id" with a known provider and an id made of the characters model ids use.
export function parseModel(
  value: string | undefined,
): { provider: Provider; id: string } | undefined {
  const [, name, id] = /^([a-z]+)\/([a-z0-9][a-z0-9._-]{0,79})$/.exec(value ?? "") ?? [];
  const provider = PROVIDERS.find((p) => p === name);
  return provider && id ? { provider, id } : undefined;
}

export const isEffort = (value: unknown): value is Effort =>
  typeof value === "string" && (EFFORTS as readonly string[]).includes(value);

export function clampLimit(name: keyof AskLimits, value: unknown): number {
  const range = LIMIT_RANGES[name];
  const n = typeof value === "number" ? value : Number(clean(String(value ?? "")) ?? Number.NaN);
  if (!Number.isFinite(n)) return range.def;
  return Math.min(range.max, Math.max(range.min, n));
}

function choice(
  model: string | undefined,
  effort: string | undefined,
  fallback: ModelChoice,
): ModelChoice {
  return {
    model: parseModel(model) ? (model as string) : fallback.model,
    effort: isEffort(effort) ? effort : fallback.effort,
  };
}

export function readAskConfig(env: Record<string, string | undefined>): AskConfig {
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => [p, Boolean(clean(env[KEY_VARS[p]]))]),
  ) as Record<Provider, boolean>;
  const limits = Object.fromEntries(
    Object.entries(LIMIT_RANGES).map(([name, range]) => [
      name,
      clean(env[range.env]) === undefined
        ? range.def
        : clampLimit(name as keyof AskLimits, env[range.env]),
    ]),
  ) as AskLimits;
  const password = clean(env.CONSOLE_PASSWORD);
  return {
    // On unless switched off: without a usable answer model the agent stays unavailable anyway.
    enabled: clean(env.ASK_AGENT_ENABLED)?.toLowerCase() !== "false",
    keys,
    answer: choice(clean(env.ASK_AGENT_MODEL), clean(env.ASK_AGENT_EFFORT), DEFAULT_ANSWER),
    guard: choice(clean(env.ASK_GUARD_MODEL), clean(env.ASK_GUARD_EFFORT), DEFAULT_GUARD),
    voice: {
      enabled: clean(env.ASK_VOICE_ENABLED)?.toLowerCase() !== "false",
      model: /^gpt-live-[a-z0-9.-]{1,20}$/.test(clean(env.ASK_VOICE_MODEL) ?? "")
        ? (clean(env.ASK_VOICE_MODEL) as string)
        : DEFAULT_VOICE_MODEL,
    },
    limits,
    consolePassword: password && password.length >= CONSOLE_PASSWORD_MIN ? password : undefined,
    // Any length, unlike the console's: a switch against casual use that the unlock route
    // rate-limits per address (spec invariant 14). Unset, voice is not offered.
    voicePassword: clean(env.VOICE_MODE_PASSWORD),
  };
}

// A model is usable only when its provider's key is set: anything else fails closed.
export const usable = (model: string, keys: Record<Provider, boolean>) => {
  const parsed = parseModel(model);
  return Boolean(parsed && keys[parsed.provider]);
};

let cached: AskConfig | undefined;

export function askConfig(): AskConfig {
  cached ??= readAskConfig(process.env);
  return cached;
}

// Tests set their own environment.
export function resetAskConfig(next?: AskConfig): void {
  cached = next;
}

// Spec: knowledge/components/ask-agent.md
// What the console may change, over the environment's defaults. A stored model whose provider lost
// its key is ignored rather than tried, and every saved change leaves an audit line.
import { get, list, put } from "../core/db";
import { newId } from "../core/util";
import {
  type AskConfig,
  type AskLimits,
  clampLimit,
  type Effort,
  isEffort,
  LIMIT_RANGES,
  type ModelChoice,
  PROVIDERS,
  parseModel,
  type Provider,
  usable,
} from "./config";

export type StoredSettings = {
  answer?: ModelChoice;
  guard?: ModelChoice;
  voiceEnabled?: boolean;
  limits?: Partial<AskLimits>;
  updatedAt?: string;
};

export type Settings = {
  answer?: ModelChoice;
  guard?: ModelChoice;
  voiceEnabled: boolean;
  limits: AskLimits;
};

export type AuditLine = { id: string; at: string; field: string; from: unknown; to: unknown };

export class SettingsError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const ID = "current";

const stored = (): StoredSettings => get<StoredSettings>("ask_settings", ID) ?? {};

function pick(saved: ModelChoice | undefined, fallback: ModelChoice, keys: AskConfig["keys"]) {
  if (saved && usable(saved.model, keys) && isEffort(saved.effort)) return saved;
  return usable(fallback.model, keys) ? fallback : undefined;
}

// The settings in force: undefined models mean the agent (or its guard) is unavailable.
export function effectiveSettings(config: AskConfig): Settings {
  const saved = stored();
  const limits = { ...config.limits };
  for (const name of Object.keys(LIMIT_RANGES) as (keyof AskLimits)[]) {
    if (saved.limits?.[name] !== undefined) limits[name] = clampLimit(name, saved.limits[name]);
  }
  return {
    answer: pick(saved.answer, config.answer, config.keys),
    guard: pick(saved.guard, config.guard, config.keys),
    voiceEnabled: config.voice.enabled && (saved.voiceEnabled ?? true),
    limits,
  };
}

function modelChoice(field: string, value: unknown, keys: AskConfig["keys"]): ModelChoice {
  const v = (value ?? {}) as { model?: unknown; effort?: unknown };
  const model = typeof v.model === "string" ? v.model : "";
  if (!parseModel(model)) throw new SettingsError(field, `${field}: not a provider/model id`);
  if (!usable(model, keys)) throw new SettingsError(field, `${field}: that provider has no key`);
  if (!isEffort(v.effort)) throw new SettingsError(field, `${field}: unknown effort`);
  return { model, effort: v.effort as Effort };
}

// Validates a whole patch before writing anything, then records one audit line per changed field.
export function saveSettings(config: AskConfig, patch: Record<string, unknown>): Settings {
  const before = effectiveSettings(config);
  const next: StoredSettings = { ...stored() };
  const changes: [string, unknown, unknown][] = [];
  if (patch.answer !== undefined) {
    next.answer = modelChoice("answer", patch.answer, config.keys);
    changes.push(["answer", before.answer, next.answer]);
  }
  if (patch.guard !== undefined) {
    next.guard = modelChoice("guard", patch.guard, config.keys);
    changes.push(["guard", before.guard, next.guard]);
  }
  if (patch.voiceEnabled !== undefined) {
    if (typeof patch.voiceEnabled !== "boolean")
      throw new SettingsError("voiceEnabled", "voiceEnabled: true or false");
    next.voiceEnabled = patch.voiceEnabled;
    changes.push(["voiceEnabled", before.voiceEnabled, patch.voiceEnabled]);
  }
  if (patch.limits !== undefined) {
    const limits = patch.limits as Record<string, unknown>;
    if (typeof limits !== "object" || limits === null)
      throw new SettingsError("limits", "limits: an object");
    next.limits = { ...next.limits };
    for (const [name, value] of Object.entries(limits)) {
      if (!(name in LIMIT_RANGES)) throw new SettingsError(name, `${name}: not a limit`);
      const key = name as keyof AskLimits;
      const range = LIMIT_RANGES[key];
      const n = Number(value);
      if (!Number.isFinite(n) || n < range.min || n > range.max)
        throw new SettingsError(name, `${name}: between ${range.min} and ${range.max}`);
      next.limits[key] = n;
      changes.push([`limits.${name}`, before.limits[key], n]);
    }
  }
  const at = new Date().toISOString();
  put("ask_settings", ID, { ...next, updatedAt: at });
  for (const [field, from, to] of changes) {
    const id = newId("audit");
    put<AuditLine>("ask_audit", id, { id, at, field, from, to });
  }
  return effectiveSettings(config);
}

export const auditLines = (limit = 100) => list<AuditLine>("ask_audit", limit);

// What the console may show: which providers have a key, never a key.
export function describeSettings(config: AskConfig) {
  const settings = effectiveSettings(config);
  return {
    providers: PROVIDERS.map((p: Provider) => ({ id: p, keySet: config.keys[p] })),
    answer: settings.answer,
    guard: settings.guard,
    voice: { enabled: settings.voiceEnabled, model: config.voice.model },
    limits: settings.limits,
    ranges: LIMIT_RANGES,
  };
}

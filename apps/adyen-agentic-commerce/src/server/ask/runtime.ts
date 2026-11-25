// Spec: knowledge/components/ask-agent.md
// The Flue runtime the house agent runs in, one per process, inside the store's own Bun server
// (ADR-018). It counts every model call a message makes and stops the message at the cap (spec
// invariants 7 and 11), and it registers only the providers whose key is set.
import { dirname, join } from "node:path";
import type { Provider as PiProvider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  type FlueEvent,
  type FlueExecutionContext,
  type FlueExecutionOperation,
  instrument,
} from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { config } from "../core/config";
import { KEY_VARS, PROVIDERS, type Provider } from "./config";

const FACTORIES: Record<Provider, () => PiProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  mistral: mistralProvider,
  deepseek: deepseekProvider,
};

// A key pasted with quotes or a trailing newline (common in dashboards and .env files) would fail
// as a wrong key; Pi reads process.env, so the value is cleaned there once, before any provider.
export function cleanKeys(env: Record<string, string | undefined> = process.env): void {
  for (const name of Object.values(KEY_VARS)) {
    const raw = env[name];
    if (raw === undefined) continue;
    const value = raw
      .trim()
      .replace(/^(["'])(.*)\1$/s, "$2")
      .trim();
    if (value) env[name] = value;
    else delete env[name];
  }
}

export function keyedProviders(
  env: Record<string, string | undefined> = process.env,
): PiProvider[] {
  return PROVIDERS.filter((p) => env[KEY_VARS[p]]).map((p) => FACTORIES[p]());
}

export type TurnUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type Meter = {
  cap: number;
  // Model requests Flue announced (its turn_request event) and requests let through.
  requested: number;
  calls: number;
  costUsd: number;
  usage: TurnUsage;
  capped: boolean;
};

const meters = new Map<string, Meter>();

// One open meter per instance, opened by the pipeline before a message and closed after it.
export function openMeter(instanceId: string, cap: number): Meter {
  const meter: Meter = {
    cap,
    requested: 0,
    calls: 0,
    costUsd: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    capped: false,
  };
  meters.set(instanceId, meter);
  return meter;
}

export function closeMeter(instanceId: string): Meter | undefined {
  const meter = meters.get(instanceId);
  meters.delete(instanceId);
  return meter;
}

export class ModelCallRefused extends Error {}

// Flue announces each model request, a retry included, with a turn_request event just before it
// opens the provider's stream; the interceptor then sees the stream's creation and each read of it.
export function announceModelRequest(instanceId: string | undefined): void {
  const meter = instanceId ? meters.get(instanceId) : undefined;
  if (meter) meter.requested++;
}

// The interceptor's decision for one model operation: a read of an admitted stream passes; a new
// request with no open meter (nothing the pipeline started) or past the cap never reaches a
// provider.
export function admitModelOperation(instanceId: string | undefined): ModelCallRefused | undefined {
  const meter = instanceId ? meters.get(instanceId) : undefined;
  if (!meter) return new ModelCallRefused("No Ask message is open for this instance");
  if (meter.requested <= meter.calls) return undefined;
  if (meter.calls >= meter.cap) {
    meter.capped = true;
    meter.requested = meter.calls;
    return new ModelCallRefused("This message used all its model calls");
  }
  meter.calls++;
  return undefined;
}

type TurnEvent = Extract<FlueEvent, { type: "turn" }>;

// What each finished call cost, failed ones included, from the provider's own usage.
export function meterTurn(event: Pick<TurnEvent, "instanceId" | "response">): void {
  const meter = event.instanceId ? meters.get(event.instanceId) : undefined;
  const usage = event.response?.usage;
  if (!meter || !usage) return;
  meter.costUsd += usage.cost?.total ?? 0;
  meter.usage.input += usage.input ?? 0;
  meter.usage.output += usage.output ?? 0;
  meter.usage.cacheRead += usage.cacheRead ?? 0;
  meter.usage.cacheWrite += usage.cacheWrite ?? 0;
}

// The SDKs behind Pi retry on their own (OpenAI's and Anthropic's twice), out of Flue's sight; with
// their retries off, every request a provider receives passes admitModelOperation first.
export function withoutClientRetries(provider: PiProvider): PiProvider {
  return new Proxy(provider, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property === "stream" || property === "streamSimple") && typeof value === "function")
        return (model: unknown, context: unknown, options?: Record<string, unknown>) =>
          value.call(target, model, context, { ...options, maxRetries: 0 });
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type Runtime = Awaited<ReturnType<typeof start>>;
type Holder = { runtime?: Promise<Runtime>; instrumented?: boolean };
// On globalThis: Next's dev server reloads modules, and two runtimes must never share one file.
const scope = globalThis as { __veluneAsk?: Holder };
scope.__veluneAsk ??= {};
const holder: Holder = scope.__veluneAsk;

export function startAskRuntime(options: {
  agents: Parameters<typeof start>[0]["agents"];
  providers?: PiProvider[];
  dbPath?: string;
}): Promise<Runtime> {
  if (!holder.instrumented) {
    holder.instrumented = true;
    void instrument({
      observe: (event) => {
        if (event.type === "turn_request") announceModelRequest(event.instanceId);
        if (event.type === "turn") meterTurn(event);
      },
      interceptor: <T>(
        operation: FlueExecutionOperation,
        context: FlueExecutionContext,
        next: () => Promise<T>,
      ): Promise<T> => {
        if (operation.type !== "model") return next();
        const refused = admitModelOperation(context.instanceId);
        return refused ? Promise.reject(refused) : next();
      },
      dispose: () => undefined,
    });
  }
  holder.runtime ??= (() => {
    cleanKeys();
    const database = config().databasePath;
    const dbPath =
      options.dbPath ??
      (database === ":memory:" ? ":memory:" : join(dirname(database), "flue.sqlite"));
    return start({
      agents: options.agents,
      db: sqlite(dbPath),
      providers: (options.providers ?? keyedProviders()).map(withoutClientRetries),
    });
  })();
  return holder.runtime;
}

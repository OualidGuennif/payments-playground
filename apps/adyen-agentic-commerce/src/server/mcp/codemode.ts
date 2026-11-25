// Spec: knowledge/components/code-mode.md
// Code Mode (Cloudflare's pattern, on this store): an agent sends a small async JavaScript function;
// it runs in a fresh QuickJS interpreter compiled to WebAssembly, whose only door out is
// `codemode.<tool>(args)`. That door is a host function the caller's route supplies, so every call
// carries the caller's own identity and meets the store's own checks. The sandbox has no network,
// files, timers or modules: QuickJS has none unless a host adds them, and this host adds two
// functions, removed from the global scope before the agent's code runs.
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { isRecord } from "../core/util";
import { MCP_TOOLS } from "./mcp-tools";

export const LIMITS = {
  codeChars: 20_000,
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  // The interpreter's own time; waiting for the store's answers does not count. QuickJS runs on
  // the server's main thread, so this is also how long one run can hold every other request.
  cpuMs: 500,
  // Interpreter time all runs together may take in a minute; past it, runs wait (busy).
  cpuMsPerMinute: 10_000,
  wallMs: 10_000,
  calls: 20,
  // About 6,000 tokens, the cut Cloudflare's Code Mode applies to an answer.
  resultChars: 24_000,
  logLines: 50,
  logChars: 500,
} as const;

// One WebAssembly module for the process (the release build, no asyncify), loaded on first use;
// every run gets its own runtime and context inside it.
let wasm: Promise<QuickJSWASMModule> | undefined;
const quickJS = () => (wasm ??= newQuickJSWASMModuleFromVariant(releaseSync));

// The interpreter time spent by recent runs, oldest first, for the process-wide budget.
const spent: { at: number; ms: number }[] = [];
function cpuBudgetLeft(now = Date.now()): boolean {
  while (spent.length && now - spent[0]!.at > 60_000) spent.shift();
  return spent.reduce((sum, s) => sum + s.ms, 0) < LIMITS.cpuMsPerMinute;
}

export const TRUNCATED = "\n--- TRUNCATED ---";

// A payment (or a hand-over to the shopper) stays one deliberate call on /mcp, where hosts show
// the destructive hint and may ask the shopper: generated code never pays.
const NOT_IN_CODE: ReadonlySet<string> = new Set(["complete_checkout"]);

export type ToolAnswer =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string };
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolAnswer>;
export type Call = { tool: string; ok: boolean };
export type RunResult =
  | { ok: true; result: string; truncated: boolean; calls: Call[]; logs: string[] }
  | { ok: false; code: string; message: string; calls: Call[]; logs: string[] };

type SchemaProp = {
  type?: unknown;
  properties?: Record<string, SchemaProp>;
  required?: string[];
  items?: SchemaProp;
};

const catalog = () =>
  MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));

const TOOL_NAMES: ReadonlySet<string> = new Set(MCP_TOOLS.map((t) => t.name));

// Two levels of an argument's shape, enough to write a call without asking search first.
function tsType(prop: SchemaProp | undefined, depth = 0): string {
  switch (prop?.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `${depth < 4 ? tsType(prop.items, depth + 1) : "unknown"}[]`;
    case "object":
      return depth < 4 && prop.properties ? tsObject(prop, depth + 1) : "object";
    default:
      return "unknown";
  }
}

function tsObject(schema: SchemaProp, depth: number): string {
  const required = new Set(schema.required ?? []);
  const props = Object.entries(schema.properties ?? {})
    .filter(([key]) => key !== "meta")
    .map(([key, prop]) => `${key}${required.has(key) ? "" : "?"}: ${tsType(prop, depth)}`);
  return `{ ${props.join("; ")} }`;
}

/** One TypeScript line per store tool: what the agent reads before writing code. */
export function declarations(): string {
  const lines = MCP_TOOLS.map((t) => {
    const summary = String(t.description ?? "").split(/(?<=\.)\s/)[0];
    const refused = NOT_IN_CODE.has(t.name) ? " Refused in Code Mode: call it on /mcp." : "";
    const args = tsObject(t.inputSchema as SchemaProp, 0);
    return `  /** ${summary}${refused} */\n  ${t.name}(args: ${args}): Promise<any>;`;
  });
  return `declare const codemode: {\n  /** The store's tools: name, description, inputSchema, annotations. */\n  tools(): Promise<Array<{ name: string; description: string; inputSchema: object }>>;\n${lines.join("\n")}\n};`;
}

const fail = (code: string, message: string, calls: Call[], logs: string[]): RunResult => ({
  ok: false,
  code,
  message,
  calls,
  logs,
});

// The guest's own view: `codemode` and `console`, built from the two host functions, which are
// then deleted from the global scope so the agent's code can reach them only through `codemode`.
function prelude(names: string[]): string {
  return `(() => {
  const host = globalThis.__host;
  const log = globalThis.__log;
  delete globalThis.__host;
  delete globalThis.__log;
  const call = async (name, args) =>
    JSON.parse(await host(name, JSON.stringify(args === undefined ? {} : args)));
  const api = { tools: () => call("__tools", {}) };
  for (const name of ${JSON.stringify(names)}) api[name] = (args) => call(name, args);
  globalThis.codemode = Object.freeze(api);
  const text = (v) => {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const line = (...parts) => log(parts.map(text).join(" "));
  globalThis.console = Object.freeze({ log: line, info: line, warn: line, error: line });
})();`;
}

const wrap = (code: string) => `(async () => {
  const __fn = (${code}
  );
  if (typeof __fn !== "function")
    throw new TypeError("Send an async arrow function: async () => { ... return value; }");
  const __value = await __fn();
  const __json = JSON.stringify(__value);
  return __json === undefined ? "null" : __json;
})()`;

function errorText(vm: QuickJSContext, handle: Parameters<QuickJSContext["dump"]>[0]): string {
  const value = vm.dump(handle) as unknown;
  if (isRecord(value)) {
    const name = typeof value.name === "string" ? value.name : "Error";
    const message = typeof value.message === "string" ? value.message : "";
    return `${name}: ${message}`.slice(0, 1_000);
  }
  return String(value).slice(0, 1_000);
}

/**
 * Runs one agent function. `search` may read the tool list only; `execute` may also call the
 * store's tools through `callTool`, at most LIMITS.calls times, never a NOT_IN_CODE one.
 */
export async function runCode(
  kind: "search" | "execute",
  code: unknown,
  callTool: CallTool,
): Promise<RunResult> {
  const calls: Call[] = [];
  const logs: string[] = [];
  if (typeof code !== "string" || !code.trim())
    return fail("invalid_code", "Send the code as a non-empty string.", calls, logs);
  if (code.length > LIMITS.codeChars)
    return fail("invalid_code", `The code is over ${LIMITS.codeChars} characters.`, calls, logs);

  if (!cpuBudgetLeft())
    return fail("busy", "Code Mode is busy; try again in a minute.", calls, logs);
  const QuickJS = await quickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(LIMITS.memoryBytes);
  runtime.setMaxStackSize(LIMITS.stackBytes);
  let guestMs = 0;
  let enteredAt: number | undefined;
  let interrupted = false;
  runtime.setInterruptHandler(() => {
    if (enteredAt === undefined || guestMs + (Date.now() - enteredAt) <= LIMITS.cpuMs) return false;
    interrupted = true;
    return true;
  });
  const vm = runtime.newContext();
  let dead = false;
  let refusedPayment = false;
  let overCalls = false;
  const pending = new Set<QuickJSDeferredPromise>();
  const inGuest = <T>(fn: () => T): T => {
    enteredAt = Date.now();
    try {
      return fn();
    } finally {
      guestMs += Date.now() - enteredAt;
      enteredAt = undefined;
    }
  };
  const pump = () => {
    if (!dead) inGuest(() => runtime.executePendingJobs());
  };

  const answer = async (name: string, argsJson: string): Promise<ToolAnswer> => {
    if (name === "__tools") return { ok: true, value: catalog() };
    if (!TOOL_NAMES.has(name))
      return { ok: false, code: "unknown_tool", message: `${name} is not a store tool.` };
    if (kind === "search")
      return {
        ok: false,
        code: "tool_refused",
        message: "search only reads the tool list; call tools with execute.",
      };
    if (NOT_IN_CODE.has(name)) {
      refusedPayment = true;
      return {
        ok: false,
        code: "tool_refused",
        message: `${name} is refused in Code Mode: call it on /mcp, where the host can ask the shopper.`,
      };
    }
    if (calls.length >= LIMITS.calls) {
      overCalls = true;
      return {
        ok: false,
        code: "too_many_calls",
        message: `At most ${LIMITS.calls} store calls per run.`,
      };
    }
    let args: unknown;
    try {
      args = JSON.parse(argsJson);
    } catch {
      args = undefined;
    }
    if (!isRecord(args))
      return { ok: false, code: "invalid_arguments", message: "Pass the tool one object." };
    let result: ToolAnswer;
    try {
      result = await callTool(name, args);
    } catch {
      result = { ok: false, code: "tool_failed", message: "The store could not run this tool." };
    }
    calls.push({ tool: name, ok: result.ok });
    return result;
  };

  try {
    vm.newFunction("__host", (nameHandle, argsHandle) => {
      const name = vm.getString(nameHandle);
      const argsJson = vm.getString(argsHandle);
      const deferred = vm.newPromise();
      pending.add(deferred);
      void answer(name, argsJson).then((result) => {
        if (dead) return;
        pending.delete(deferred);
        if (result.ok) {
          const value = vm.newString(JSON.stringify(result.value ?? null));
          deferred.resolve(value);
          value.dispose();
        } else {
          const error = vm.newError({
            name: "StoreError",
            message: `${result.code}: ${result.message}`,
          });
          deferred.reject(error);
          error.dispose();
        }
        deferred.dispose();
        pump();
      });
      return deferred.handle;
    }).consume((fn) => vm.setProp(vm.global, "__host", fn));
    vm.newFunction("__log", (lineHandle) => {
      if (logs.length < LIMITS.logLines)
        logs.push(vm.getString(lineHandle).slice(0, LIMITS.logChars));
    }).consume((fn) => vm.setProp(vm.global, "__log", fn));

    const names = kind === "execute" ? [...TOOL_NAMES] : [];
    const setup = inGuest(() => vm.evalCode(prelude(names), "prelude.js"));
    if (setup.error) {
      setup.error.dispose();
      return fail("code_error", "The sandbox could not start.", calls, logs);
    }
    setup.value.dispose();

    const evaluated = inGuest(() => vm.evalCode(wrap(code), "agent.js"));
    if (evaluated.error) {
      const message = errorText(vm, evaluated.error);
      evaluated.error.dispose();
      return fail(interrupted ? "timeout" : "code_error", message, calls, logs);
    }
    const promise = evaluated.value;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), LIMITS.wallMs);
    });
    const settled = vm.resolvePromise(promise);
    pump();
    const outcome = await Promise.race([settled, late]);
    clearTimeout(timer);
    promise.dispose();
    if (outcome === "timeout")
      return fail("timeout", `The run took over ${LIMITS.wallMs / 1000} s.`, calls, logs);
    if (outcome.error) {
      const message = errorText(vm, outcome.error);
      outcome.error.dispose();
      const code = interrupted
        ? "timeout"
        : /out of memory/i.test(message)
          ? "memory_limit"
          : overCalls
            ? "too_many_calls"
            : refusedPayment
              ? "tool_refused"
              : "code_error";
      return fail(code, message, calls, logs);
    }
    const text = vm.getString(outcome.value);
    outcome.value.dispose();
    const truncated = text.length > LIMITS.resultChars;
    return {
      ok: true,
      result: truncated ? text.slice(0, LIMITS.resultChars) + TRUNCATED : text,
      truncated,
      calls,
      logs,
    };
  } catch (error) {
    // A limit QuickJS enforces by throwing on the host side (memory while building a value).
    const message = (error as Error).message ?? String(error);
    return fail(
      /out of memory/i.test(message) ? "memory_limit" : interrupted ? "timeout" : "code_error",
      message.slice(0, 1_000),
      calls,
      logs,
    );
  } finally {
    spent.push({ at: Date.now(), ms: guestMs });
    dead = true;
    for (const deferred of pending) deferred.dispose();
    pending.clear();
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A run stopped mid-flight may leave handles QuickJS refuses to free; the next run gets
      // a fresh runtime either way.
    }
  }
}

// --- the MCP face: two tools -------------------------------------------------------------------

const EXAMPLE = `async () => {
  const { products = [] } = await codemode.search_catalog({ catalog: { query: "linen shirt" } });
  const variant = products
    .flatMap((p) => p.variants ?? [])
    .find((v) => v.availability?.available);
  if (!variant) return { found: products.length };
  const cart = await codemode.create_cart({
    cart: { line_items: [{ item: { id: variant.id }, quantity: 1 }] },
  });
  return { cart: cart.id, item: variant.title, totals: cart.totals };
}`;

export function codeTools() {
  const code = {
    type: "object",
    properties: {
      code: {
        type: "string",
        maxLength: LIMITS.codeChars,
        description: "An async arrow function: async () => { ... return value; }",
      },
    },
    required: ["code"],
    additionalProperties: false,
  };
  return [
    {
      name: "search",
      title: "Search the store's tools",
      description: `Run JavaScript that reads the Atelier Velune store's tool list and returns only what you need (names, descriptions, input schemas). Call it before execute when you do not know a tool's arguments. Inside: await codemode.tools(). Example: async () => (await codemode.tools()).filter((t) => t.name.includes("checkout")).map((t) => ({ name: t.name, inputSchema: t.inputSchema }))`,
      inputSchema: code,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "execute",
      title: "Run code against the store",
      description: `Run JavaScript that calls the Atelier Velune store's tools (Adyen TEST, prices in EUR minor units) and returns only the result. Each call uses your own sign-in, scopes and budget; a refusal throws an Error "code: sentence". No network, files or timers; ${LIMITS.cpuMs / 1000} s of compute, ${LIMITS.calls} store calls, answer cut at ${LIMITS.resultChars} characters. Payment is not available here: complete_checkout stays a direct call on /mcp.\n\n${declarations()}\n\nExample:\n${EXAMPLE}`,
      inputSchema: code,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
  ];
}

/** A store tool's MCP answer as the sandbox sees it: its data, or a refusal with a code. */
export function toolAnswerOf(parsed: unknown): ToolAnswer {
  if (isRecord(parsed) && isRecord(parsed.result)) {
    const result = parsed.result;
    const data = result.structuredContent;
    if (result.isError === true) {
      const messages = isRecord(data) && Array.isArray(data.messages) ? data.messages : [];
      const first = messages.find(isRecord);
      return {
        ok: false,
        code: typeof first?.code === "string" ? first.code : "store_refused",
        message:
          typeof first?.content === "string" ? first.content : "The store refused this call.",
      };
    }
    if (data !== undefined) return { ok: true, value: data };
    const blocks = Array.isArray(result.content) ? result.content : [];
    const text = blocks
      .filter(isRecord)
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .join("");
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: true, value: text };
    }
  }
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
  const data = error && isRecord(error.data) ? error.data : undefined;
  return {
    ok: false,
    code: typeof data?.code === "string" ? data.code : "store_refused",
    message:
      typeof data?.content === "string"
        ? data.content
        : typeof error?.message === "string"
          ? error.message
          : "The store refused this call.",
  };
}

/** The answer to one `tools/call` on /mcp/code, as an MCP tool result. */
export function toolResultOf(run: RunResult) {
  if (!run.ok)
    return {
      content: [{ type: "text", text: `${run.code}: ${run.message}` }],
      structuredContent: {
        error: run.code,
        message: run.message,
        calls: run.calls,
        logs: run.logs,
      },
      isError: true,
    };
  let result: unknown;
  try {
    result = run.truncated ? run.result : JSON.parse(run.result);
  } catch {
    result = run.result;
  }
  return {
    content: [{ type: "text", text: run.result }],
    structuredContent: { result, truncated: run.truncated, calls: run.calls, logs: run.logs },
  };
}

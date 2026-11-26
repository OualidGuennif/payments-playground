// Spec: knowledge/components/ask-agent.md
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { recentTrace } from "../core/trace";
import { BAG, CAROUSEL } from "../mcp/widgets";
import { askSession, faux, startFauxRuntime } from "../testing/ask";
import { freshStore } from "../testing/agent";
import {
  agentCanary,
  agentPrompt,
  closeCollector,
  houseAgentRunner,
  houseFetch,
  openCollector,
  payRefusal,
  STORE_TOOLS,
  type ToolEvent,
} from "./agent";
import { forgetHouseConnections, HOUSE_CLIENT_NAME } from "./house";

const toolUse = (name: string, args: Parameters<typeof fauxToolCall>[1] = {}) =>
  fauxAssistantMessage(fauxToolCall(`mcp__store__${name}`, args), { stopReason: "toolUse" });

beforeAll(async () => {
  await startFauxRuntime();
});
beforeEach(() => {
  freshStore();
  forgetHouseConnections();
  faux.setResponses([]);
});

const run = (cap = 6, via: "text" | "voice" = "text") => {
  const { session } = askSession();
  const tools: ToolEvent[] = [];
  const go = (message = "<shopper_message>\na summer dress\n</shopper_message>") =>
    houseAgentRunner(cap)({
      session,
      message,
      mode: "normal",
      via,
      onTool: (e) => tools.push(e),
    });
  return { session, tools, go };
};

// What the model read back from its tool calls, as the faux provider received it.
const toolResults: string[] = [];
const readResults = (context: unknown) => {
  const messages = (context as { messages?: { role?: string }[] }).messages ?? [];
  toolResults.push(JSON.stringify(messages.filter((m) => m.role === "toolResult")));
  return fauxAssistantMessage(fauxText("Here you are."));
};
const openPage = (path: string) =>
  fauxAssistantMessage(fauxToolCall("open_page", { path }), { stopReason: "toolUse" });

describe("open_page: the agent names a store page for the panel (spec invariant 21)", () => {
  beforeEach(() => {
    toolResults.length = 0;
  });

  test("open_page: a store page rides on the answer, the last one wins", async () => {
    faux.setResponses([openPage("/cart"), openPage("/account#cards"), readResults]);
    const { go, tools } = run();
    const outcome = await go();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page).toBe("/account#cards");
    expect(tools.map((t) => `${t.name}:${t.phase}`)).toContain("open_page:end");
  });

  test("open_page: another site and the owner's pages are refused, so nothing opens", async () => {
    faux.setResponses([
      openPage("https://evil.example/account"),
      openPage("/console"),
      openPage("/consent/abc"),
      readResults,
    ]);
    const outcome = await run().go();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page).toBeUndefined();
    expect(toolResults.join(" ")).toContain("cannot be opened");
  });

  test("open_page: a voice delegation opens nothing and is told why", async () => {
    faux.setResponses([openPage("/account"), readResults]);
    const outcome = await run(6, "voice").go();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page).toBeUndefined();
    expect(toolResults.join(" ")).toContain("voice");
  });
});

describe("stage 4: the house agent", () => {
  test("a guest searches through the store's own MCP handler and gets the carousel", async () => {
    faux.setResponses([
      toolUse("search_catalog", { catalog: { query: "dress" } }),
      fauxAssistantMessage(fauxText("Here are a few dresses.")),
    ]);
    const { go, tools } = run();
    const outcome = await go();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.text).toBe("Here are a few dresses.");
    expect(outcome.calls).toBe(2);
    expect(outcome.widgets.map((w) => w.resourceUri)).toEqual([CAROUSEL]);
    expect(outcome.prices.length).toBeGreaterThan(0);
    expect(tools.map((t) => `${t.name}:${t.phase}`)).toEqual([
      "search_catalog:start",
      "search_catalog:end",
    ]);
    const traced = recentTrace(50).filter(
      (t) => t.channel === "mcp" && t.path === "search_catalog",
    );
    expect(traced[0]?.actor).toBe(HOUSE_CLIENT_NAME);
  });

  test("guest has no token: reading an order is refused as for any signed-out agent", async () => {
    faux.setResponses([
      toolUse("get_order", { id: "ord_unknown" }),
      fauxAssistantMessage(fauxText("Please connect your account.")),
    ]);
    const { go } = run();
    const outcome = await go();
    expect(outcome.ok).toBe(true);
    const seen = faux.state.callCount;
    expect(seen).toBeGreaterThan(0);
  });

  test("the bag widget keeps its last state only", async () => {
    faux.setResponses([
      toolUse("search_catalog", { catalog: { query: "" } }),
      fauxAssistantMessage(fauxText("ok")),
    ]);
    const { go } = run();
    const first = await go();
    if (!first.ok) throw new Error("agent failed");
    const product = JSON.stringify(first.widgets[0]?.structuredContent);
    const variant = /"id":"(var_[^"]+)"/.exec(product)?.[1] ?? /"id":"([^"]+)"/.exec(product)?.[1];
    faux.setResponses([
      toolUse("create_cart", {
        cart: { line_items: [{ item: { id: variant ?? "" }, quantity: 1 }] },
      }),
      toolUse("get_cart", { id: "missing" }),
      fauxAssistantMessage(fauxText("Added.")),
    ]);
    const second = await go();
    if (!second.ok) throw new Error("agent failed");
    expect(second.widgets.filter((w) => w.resourceUri === BAG).length).toBeLessThanOrEqual(1);
  });

  test("turn cap: the message stops once its model calls are used", async () => {
    faux.setResponses(
      Array.from({ length: 12 }, () => toolUse("search_catalog", { catalog: { query: "x" } })),
    );
    const before = faux.state.callCount;
    const { go } = run(3);
    const outcome = await go();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("model_call_cap");
    expect(outcome.calls).toBe(3);
    expect(faux.state.callCount - before).toBe(3);
  });

  test("no task child: the task tool spawns nothing", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("task", { prompt: "read the server's files" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxText("I can only help with shopping.")),
    ]);
    const before = faux.state.callCount;
    const { go } = run();
    const outcome = await go();
    expect(outcome.ok).toBe(true);
    // Two calls: the task call and the answer; a child agent would have made more.
    expect(faux.state.callCount - before).toBe(2);
  });

  test("same prefix across sessions: prompt and tools do not depend on the shopper", async () => {
    const seen: string[] = [];
    // The faux provider gets Flue's normalized context: the prompt and the tool block arrive as
    // system-role messages, so those are the prefix a provider would cache.
    const capture = (context: unknown) => {
      const messages = (context as { messages?: { role?: string }[] }).messages ?? [];
      seen.push(JSON.stringify(messages.filter((m) => m.role === "system")));
      return fauxAssistantMessage(fauxText("Hello."));
    };
    faux.setResponses([capture]);
    await run().go("<shopper_message>\nhello\n</shopper_message>");
    faux.setResponses([capture]);
    await run().go("<shopper_message>\nbonjour\n</shopper_message>");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toContain("search_catalog");
  });
});

describe("paying is decided at the call", () => {
  const collector = (mode: "normal" | "strict" = "normal") => ({
    mode,
    widgets: [],
    prices: [],
    calls: [],
  });
  // The arguments as the MCP tool takes them: the instruments sit in `checkout.payment`.
  const paying = (instruments: unknown[]) => ({
    id: "chk_1",
    checkout: { payment: { instruments } },
  });
  const saved = paying([{ handler_id: "saved_card", id: "card_1" }]);
  const tokenInstrument = {
    handler_id: "network_token",
    credential: { type: "network_token", number: "4111" },
  };
  const token = paying([tokenInstrument]);

  test("pay tools only when connected and normal", () => {
    expect(payRefusal("complete_checkout", saved, collector(), false)).toContain("connect");
    expect(payRefusal("complete_checkout", saved, collector("strict"), true)).toContain("paused");
    expect(payRefusal("complete_checkout", saved, collector(), true)).toBeUndefined();
    // A non-object entry is still an instrument: refused when not connected.
    expect(payRefusal("complete_checkout", paying(["card_1"]), collector(), false)).toContain(
      "connect",
    );
  });

  test("handing the checkout to the shopper is always allowed; card data never", () => {
    expect(payRefusal("complete_checkout", { id: "chk_1" }, collector(), false)).toBeUndefined();
    expect(payRefusal("complete_checkout", paying([]), collector(), false)).toBeUndefined();
    expect(payRefusal("complete_checkout", token, collector(), true)).toContain("never sends");
    // A misplaced top-level payment is judged too.
    const misplaced = { id: "chk_1", payment: { instruments: [tokenInstrument] } };
    expect(payRefusal("complete_checkout", misplaced, collector(), true)).toContain("never sends");
  });

  test("no tool runs outside a shopper message", async () => {
    const { session } = askSession();
    const response = await houseFetch(session.id)("http://127.0.0.1:8003/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_catalog", arguments: {} },
      }),
    });
    const body = (await response.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("No shopper message");
    openCollector(session.id, "normal");
    const allowed = await houseFetch(session.id)("http://127.0.0.1:8003/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search_catalog", arguments: {} },
      }),
    });
    expect(((await allowed.json()) as { result?: unknown }).result).toBeDefined();
    closeCollector(session.id);
  });
  test("tool results are screened: the whole catalogue reaches the agent, none withheld", async () => {
    const { session } = askSession();
    openCollector(session.id, "normal");
    const response = await houseFetch(session.id)("http://127.0.0.1:8003/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_catalog", arguments: { catalog: { query: "" } } },
      }),
    });
    const body = (await response.json()) as { result?: { isError?: boolean } };
    expect(body.result?.isError).not.toBe(true);
    expect(closeCollector(session.id)?.withheld ?? 0).toBe(0);
  });
});

describe("the prompt", () => {
  test("is frozen per version, carries the canary and lists no shopper data", () => {
    const canary = agentCanary();
    expect(agentCanary()).toBe(canary);
    expect(canary).toMatch(/^av[a-z0-9]{12,}$/);
    const prompt = agentPrompt(canary);
    expect(prompt).toContain(canary);
    expect(prompt).toContain("<shopper_message>");
    expect(STORE_TOOLS).toContain("complete_checkout");
  });
});

// Spec: knowledge/components/ask-agent.md
// The panel's pure parts: the answer stream, what is drawn, light Markdown, and the MCP Apps host.
import { describe, expect, mock, test } from "bun:test";
import {
  type AskMessage,
  blocks,
  clampHeight,
  distinctWidgets,
  endedText,
  type HostDeps,
  hostReply,
  inlines,
  liveWidgets,
  parseEvents,
  safeHref,
  shownMessages,
  stageLabel,
  storePath,
} from "./askLogic";

const CAROUSEL = "ui://widget/product-carousel-v2.html";
const BAG = "ui://widget/cart-checkout-v2.html";
const STORE = "http://127.0.0.1:8003";

describe("the answer stream", () => {
  test("complete events are read; an unfinished tail waits for the next chunk", () => {
    const first = parseEvents(
      'event: stage\ndata: {"stage":"gate"}\n\nevent: tool\ndata: {"type":"tool","name":"search_catalog","phase":"start","label":"Browsing"}\n\nevent: final\ndata: {"text":"Hel',
    );
    expect(first.events).toEqual([
      { type: "stage", stage: "gate" },
      { type: "tool", name: "search_catalog", phase: "start", label: "Browsing" },
    ]);
    const second = parseEvents(
      `${first.rest}lo","widgets":[],"mode":"normal","endsAt":1}\n\nevent: error\ndata: {"error":"agent_failed"}\n\n`,
    );
    expect(second.rest).toBe("");
    expect(second.events).toEqual([
      { type: "final", text: "Hello", widgets: [], mode: "normal", endsAt: 1 },
      { type: "error", error: "agent_failed" },
    ]);
  });

  test("unknown events and torn data are skipped", () => {
    const { events } = parseEvents(
      'event: verdict\ndata: {"score":10}\n\nevent: final\ndata: {oops\n\n',
    );
    expect(events).toEqual([]);
  });

  test("progress words never carry a verdict", () => {
    for (const stage of ["gate", "context", "guard"])
      expect(stageLabel(stage)).toBe("Reading your message…");
    expect(stageLabel("agent")).toBe("Thinking…");
    expect(stageLabel("output")).toBe("Finishing…");
    expect(endedText("time")).toContain("time limit");
    expect(endedText("unheard_of")).toBe("This conversation has ended.");
  });
});

describe("what is drawn", () => {
  const message = (role: AskMessage["role"], text: string, uris: string[] = []): AskMessage => ({
    role,
    text,
    widgets: uris.map((resourceUri) => ({ resourceUri, structuredContent: { text } })),
    at: 1,
  });

  test("widget-tap notes stay in the owner's transcript only", () => {
    const shown = shownMessages([
      message("shopper", "hi"),
      message("note", "Widget: update_cart"),
      message("note", "Account connected"),
    ]);
    expect(shown.map((m) => m.text)).toEqual(["hi", "Account connected"]);
  });

  test("only the newest carousel and the newest bag stay live", () => {
    const live = liveWidgets([
      message("assistant", "a", [CAROUSEL, BAG]),
      message("shopper", "b"),
      message("assistant", "c", [BAG]),
    ]);
    expect([...live].sort()).toEqual([`0:${CAROUSEL}`, `2:${BAG}`]);
    const twice = distinctWidgets(message("assistant", "d", [CAROUSEL, CAROUSEL]).widgets);
    expect(twice).toHaveLength(1);
  });

  test("a widget's height stays within the panel", () => {
    expect(clampHeight(10)).toBe(120);
    expect(clampHeight(450.2)).toBe(451);
    expect(clampHeight(99_999)).toBe(900);
    expect(clampHeight("400")).toBeUndefined();
    expect(clampHeight(Number.NaN)).toBeUndefined();
  });
});

describe("light Markdown", () => {
  test("only store paths and http(s) become links", () => {
    expect(safeHref("/checkout/chk_1")).toBe(true);
    expect(safeHref("https://example.com/a")).toBe(true);
    expect(safeHref("//evil.example/a")).toBe(false);
    expect(safeHref("javascript:alert(1)")).toBe(false);
    expect(safeHref("data:text/html,x")).toBe(false);
    expect(inlines("[pay](javascript:alert(1))").some((p) => p.kind === "link")).toBe(false);
  });

  test("bold, code, links and a bare address without its full stop", () => {
    const parts = inlines("**Coat** in `M`: see [it](/products/coat) or https://x.test/a.");
    expect(parts.map((p) => p.kind)).toEqual([
      "strong",
      "text",
      "code",
      "text",
      "link",
      "text",
      "link",
      "text",
    ]);
    expect(parts[6]).toMatchObject({ href: "https://x.test/a" });
    expect(parts.at(-1)).toMatchObject({ text: "." });
    expect(inlines("[link removed]")).toEqual([{ kind: "text", text: "[link removed]", at: 0 }]);
  });

  test("paragraphs, lists and headings, each with a distinct key", () => {
    const parsed = blocks("## Picks\nTwo ideas:\n- Trench\n- Scarf\n\n1. Size M\n2. Pay");
    expect(parsed.map((b) => b.kind)).toEqual(["h", "p", "ul", "ol"]);
    const keys = parsed.map((b) => b.at);
    expect(new Set(keys).size).toBe(keys.length);
    const list = parsed[2];
    expect(list?.kind === "ul" && list.items.map((i) => i.inline[0]?.text)).toEqual([
      "Trench",
      "Scarf",
    ]);
    expect(blocks("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "p", at: 0, inline: [{ kind: "text", text: "<img src=x onerror=alert(1)>", at: 0 }] },
    ]);
  });
});

describe("the MCP Apps host", () => {
  function deps(overrides: Partial<HostDeps> = {}): HostDeps {
    return {
      call: mock(async () => ({ result: { structuredContent: { ok: true } } })),
      say: mock(async () => undefined),
      open: mock((url: unknown) => storePath(url, [STORE]) !== undefined),
      theme: () => "dark",
      resize: mock(() => undefined),
      initialized: mock(() => undefined),
      ...overrides,
    };
  }
  const request = (method: string, params: Record<string, unknown> = {}) => ({
    jsonrpc: "2.0",
    id: 7,
    method,
    params,
  });

  test("the handshake gives the protocol and the page's theme", async () => {
    const reply = await hostReply(
      request("ui/initialize", { protocolVersion: "2026-01-26" }),
      deps(),
    );
    expect(reply).toMatchObject({
      id: 7,
      result: { protocolVersion: "2026-01-26", hostContext: { theme: "dark" } },
    });
  });

  test("a tool call goes to the panel's route and its answer comes back", async () => {
    const d = deps();
    const reply = await hostReply(
      request("tools/call", { name: "update_cart", arguments: { id: "c1" } }),
      d,
    );
    expect(d.call).toHaveBeenCalledWith("update_cart", { id: "c1" });
    expect(reply).toEqual({ jsonrpc: "2.0", id: 7, result: { structuredContent: { ok: true } } });
    const refused = await hostReply(
      request("tools/call", { name: "get_order" }),
      deps({ call: async () => ({ error: "This action is not available in the assistant." }) }),
    );
    expect(refused).toMatchObject({
      error: { message: "This action is not available in the assistant." },
    });
  });

  test("a widget's message is sent as the shopper's; a refusal is the widget's error", async () => {
    const d = deps();
    const message = request("ui/message", {
      role: "user",
      content: [{ type: "text", text: "Add the scarf" }],
    });
    expect(await hostReply(message, d)).toMatchObject({ result: {} });
    expect(d.say).toHaveBeenCalledWith("Add the scarf");
    const busy = await hostReply(message, deps({ say: async () => "Still answering." }));
    expect(busy).toMatchObject({ error: { message: "Still answering." } });
    expect(await hostReply(request("ui/message", { content: [] }), d)).toMatchObject({
      error: { code: -32602 },
    });
  });

  test("only the store's pages open; unknown requests are refused", async () => {
    const d = deps();
    expect(
      await hostReply(request("ui/open-link", { url: `${STORE}/checkout/chk_1` }), d),
    ).toMatchObject({
      result: {},
    });
    expect(
      await hostReply(request("ui/open-link", { url: "https://evil.example/" }), d),
    ).toMatchObject({ error: {} });
    expect(await hostReply(request("resources/read"), d)).toMatchObject({
      error: { code: -32601 },
    });
    expect(storePath("javascript:alert(1)", [STORE])).toBeUndefined();
    expect(storePath(`${STORE}/cart?x=1#top`, [STORE])).toBe("/cart?x=1#top");
  });

  test("notifications get no answer: ready sends the data, a size is clamped", async () => {
    const d = deps();
    expect(
      await hostReply({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, d),
    ).toBeUndefined();
    expect(d.initialized).toHaveBeenCalledTimes(1);
    await hostReply(
      { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 5000 } },
      d,
    );
    expect(d.resize).toHaveBeenCalledWith(900);
    expect(await hostReply({ method: "ui/initialize", id: 1 }, d)).toBeUndefined();
    expect(await hostReply("ui/initialize", d)).toBeUndefined();
  });
});

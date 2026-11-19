// Unit tests for MCP Apps widget bridge origin pinning (invariant 29).
// Spec: knowledge/components/adyen-agentic-commerce.md
import { afterEach, describe, expect, test } from "bun:test";
import { connect, type Theme } from "./bridge";

type Listener = (event: {
  source?: unknown;
  origin?: string;
  data?: unknown;
  detail?: unknown;
}) => void;

type Posted = { message: Record<string, unknown>; targetOrigin: string };

const ORIGINS = {
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  ResizeObserver: Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"),
};

afterEach(() => {
  for (const [key, desc] of Object.entries(ORIGINS)) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

function installDom() {
  const listeners = new Map<string, Set<Listener>>();
  const posted: Posted[] = [];
  const parent = {
    postMessage(message: Record<string, unknown>, targetOrigin: string) {
      posted.push({ message, targetOrigin });
    },
  };
  const win: Record<string, unknown> = {
    parent,
    addEventListener(type: string, fn: Listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
  };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", {
    value: {
      documentElement: { getBoundingClientRect: () => ({ height: 320 }) },
      body: {},
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: class {
      observe() {}
    },
    configurable: true,
    writable: true,
  });
  const dispatchMessage = (source: unknown, origin: string, data: unknown) => {
    for (const fn of listeners.get("message") ?? []) {
      fn({ source, origin, data });
    }
  };
  const dispatchGlobals = (globals: unknown) => {
    for (const fn of listeners.get("openai:set_globals") ?? []) {
      fn({ detail: { globals } });
    }
  };
  return { win, parent, posted, dispatchMessage, dispatchGlobals };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("connect() origin pinning", () => {
  test("sends ui/initialize to '*'", async () => {
    const { parent, posted, dispatchMessage } = installDom();
    connect({ result: () => {}, theme: () => {} });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.message.method).toBe("ui/initialize");
    expect(posted[0]?.targetOrigin).toBe("*");

    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: posted[0]?.message.id,
      result: {},
    });
    await flush();
  });

  test("ignores messages not from window.parent and does not pin foreign origin", async () => {
    const { parent, posted, dispatchMessage } = installDom();
    const themes: Theme[] = [];
    connect({ result: () => {}, theme: (t) => themes.push(t) });

    const initId = posted[0]?.message.id;
    dispatchMessage({ foreign: true }, "https://evil.example", {
      jsonrpc: "2.0",
      id: initId,
      result: { hostContext: { theme: "dark" } },
    });
    await flush();
    expect(posted).toHaveLength(1);
    expect(themes).toEqual([]);

    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: initId,
      result: { hostContext: { theme: "dark" } },
    });
    await flush();
    expect(themes).toEqual(["dark"]);
    expect(posted[1]?.message.method).toBe("ui/notifications/initialized");
    expect(posted[1]?.targetOrigin).toBe("https://chatgpt.com");
  });

  test("pins initialized, call, say, and open to the parent origin after first reply", async () => {
    const { parent, posted, dispatchMessage } = installDom();
    const host = connect({ result: () => {}, theme: () => {} });

    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: posted[0]?.message.id,
      result: { hostContext: { theme: "light" } },
    });
    await flush();

    const callPromise = host.call("search_catalog", { query: "coat" });
    const callReq = posted.at(-1);
    expect(callReq?.message.method).toBe("tools/call");
    expect(callReq?.targetOrigin).toBe("https://chatgpt.com");
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: callReq?.message.id,
      result: { structuredContent: { items: [] } },
    });
    await callPromise;

    const sayPromise = host.say("Add to my bag.");
    const sayReq = posted.at(-1);
    expect(sayReq?.message.method).toBe("ui/message");
    expect(sayReq?.targetOrigin).toBe("https://chatgpt.com");
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: sayReq?.message.id,
      result: {},
    });
    await sayPromise;

    const openPromise = host.open("https://store.example/account");
    const openReq = posted.at(-1);
    expect(openReq?.message.method).toBe("ui/open-link");
    expect(openReq?.targetOrigin).toBe("https://chatgpt.com");
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: openReq?.message.id,
      result: {},
    });
    await openPromise;

    expect(posted.slice(1).every((entry) => entry.targetOrigin === "https://chatgpt.com")).toBe(
      true,
    );
  });

  test("keeps '*' target when parent has an opaque ('null') origin", async () => {
    const { parent, posted, dispatchMessage } = installDom();
    const host = connect({ result: () => {}, theme: () => {} });

    dispatchMessage(parent, "null", {
      jsonrpc: "2.0",
      id: posted[0]?.message.id,
      result: {},
    });
    await flush();

    expect(posted[1]?.message.method).toBe("ui/notifications/initialized");
    expect(posted[1]?.targetOrigin).toBe("*");

    const callPromise = host.call("search_catalog", { query: "scarf" });
    const callReq = posted.at(-1);
    expect(callReq?.message.method).toBe("tools/call");
    expect(callReq?.targetOrigin).toBe("*");
    dispatchMessage(parent, "null", {
      jsonrpc: "2.0",
      id: callReq?.message.id,
      result: { structuredContent: { ok: true } },
    });
    const result = await callPromise;
    expect(result.structuredContent).toEqual({ ok: true });
  });
});

describe("host bridge stability and state updates", () => {
  test("ignores repeated identical toolOutput and stale openai:set_globals once standard host initializes", async () => {
    const { win, parent, posted, dispatchMessage, dispatchGlobals } = installDom();
    const seen: unknown[] = [];
    win.openai = { toolOutput: { id: "cart_1", total: 14900 } };
    connect({ result: (data) => seen.push(data), theme: () => {} });
    expect(seen).toEqual([{ id: "cart_1", total: 14900 }]);

    dispatchGlobals({ toolOutput: { id: "cart_1", total: 14900 } });
    expect(seen).toHaveLength(1);

    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: posted[0]?.message.id,
      result: {},
    });
    await flush();

    // Once ui/initialize answered, stale openai:set_globals toolOutput cannot revert the widget.
    dispatchGlobals({ toolOutput: { id: "cart_old", total: 9900 } });
    expect(seen).toHaveLength(1);

    // Genuine MCP Apps notifications still update the view.
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: { id: "chk_1", total: 14900 } },
    });
    expect(seen).toEqual([
      { id: "cart_1", total: 14900 },
      { id: "chk_1", total: 14900 },
    ]);
  });

  test("tellModel uses silent setWidgetState when openai exists and structuredContent otherwise", async () => {
    const { win, parent, posted, dispatchMessage } = installDom();
    const widgetStates: unknown[] = [];
    win.openai = {
      widgetState: { privateContent: { mode: "hand" } },
      setWidgetState(state: Record<string, unknown>) {
        widgetStates.push(state);
      },
    };
    const hostWithOpenai = connect({ result: () => {}, theme: () => {} });
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: posted[0]?.message.id,
      result: {},
    });
    await flush();

    hostWithOpenai.tellModel("Cart updated", { id: "cart_1" });
    expect(hostWithOpenai.recalled()).toEqual({ mode: "hand" });
    expect(posted.some((p) => p.message.method === "ui/update-model-context")).toBe(false);
    expect(widgetStates).toEqual([
      { modelContent: "Cart updated", privateContent: { mode: "hand" } },
    ]);

    const second = installDom();
    const standardOnly = connect({ result: () => {}, theme: () => {} });
    dispatchMessageFrom(second.dispatchMessage, second.parent, second.posted[0]?.message.id);
    await flush();

    standardOnly.tellModel("Bag ready", { id: "chk_2" });
    const ctxReq = second.posted.at(-1);
    expect(ctxReq?.message.method).toBe("ui/update-model-context");
    expect(ctxReq?.message.params).toEqual({ structuredContent: { id: "chk_2" } });
  });

  test("call parses JSON text when structuredContent is absent, and open falls back to openExternal", async () => {
    const { win, parent, posted, dispatchMessage } = installDom();
    const opened: unknown[] = [];
    win.openai = {
      openExternal(args: unknown) {
        opened.push(args);
      },
    };
    const host = connect({ result: () => {}, theme: () => {} });
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: posted[0]?.message.id,
      result: {},
    });
    await flush();

    const callPromise = host.call("create_checkout", { checkout: { cart_id: "cart_1" } });
    const callReq = posted.at(-1);
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: callReq?.message.id,
      result: { content: [{ type: "text", text: '{"id":"chk_fallback"}' }] },
    });
    expect(await callPromise).toMatchObject({ structuredContent: { id: "chk_fallback" } });

    const openPromise = host.open("https://agentic.payments-playground.com/checkout/chk_1");
    const openReq = posted.at(-1);
    dispatchMessage(parent, "https://chatgpt.com", {
      jsonrpc: "2.0",
      id: openReq?.message.id,
      error: { code: -32601, message: "Unsupported" },
    });
    await openPromise;
    expect(opened).toEqual([
      { href: "https://agentic.payments-playground.com/checkout/chk_1", redirectUrl: false },
    ]);
  });
});

function dispatchMessageFrom(
  dispatch: (source: unknown, origin: string, data: unknown) => void,
  parent: unknown,
  id: unknown,
) {
  dispatch(parent, "https://chatgpt.com", { jsonrpc: "2.0", id, result: {} });
}

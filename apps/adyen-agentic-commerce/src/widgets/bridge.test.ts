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
  return { parent, posted, dispatchMessage };
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

// Spec: knowledge/components/adyen-agentic-commerce.md
// The widget's only way out: the host. The MCP Apps bridge (JSON-RPC over postMessage to the
// parent frame) comes first; ChatGPT's window.openai stands in when the handshake gets no answer.
// Nothing here holds a token: the host runs each tool on the shopper's own grant (ADR-017).

type Json = Record<string, unknown>;
export type CallResult = { structuredContent?: unknown; isError?: boolean };
export type Theme = "light" | "dark";
export type Host = {
  call(name: string, args: Json): Promise<CallResult>;
  say(text: string): Promise<void>;
  open(url: string): Promise<void>;
  tellModel(text: string): void;
  remember(state: Json): void;
  recalled(): Json;
};

type OpenAi = {
  toolOutput?: unknown;
  theme?: string;
  widgetState?: unknown;
  callTool?: (name: string, args: Json) => Promise<unknown>;
  sendFollowUpMessage?: (args: { prompt: string }) => Promise<void>;
  openExternal?: (args: { href: string }) => void | Promise<void>;
  setWidgetState?: (state: Json) => void | Promise<void>;
  notifyIntrinsicHeight?: (height: number) => void;
};

const PROTOCOL = "2026-01-26";
const record = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const themeOf = (v: unknown): Theme | undefined => (v === "dark" || v === "light" ? v : undefined);

export function connect(on: { result(data: unknown): void; theme(theme: Theme): void }): Host {
  const openai = (): OpenAi | undefined => (window as unknown as { openai?: OpenAi }).openai;
  let standard = false;
  let nextId = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  function request(method: string, params: Json, ms: number): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no answer from the host`));
      }, ms);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      // The host's origin is not known to the widget; nothing sent here is secret.
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }
  const notify = (method: string, params: Json) =>
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");

  window.addEventListener("message", (event) => {
    // Only the frame that embeds the widget speaks for the host.
    if (event.source !== window.parent || !record(event.data)) return;
    const m = event.data;
    if (typeof m.id === "number" && pending.has(m.id) && !("method" in m)) {
      const waiting = pending.get(m.id)!;
      pending.delete(m.id);
      if (record(m.error)) waiting.reject(new Error(String(m.error.message ?? "Host error")));
      else waiting.resolve(m.result);
      return;
    }
    const params = record(m.params) ? m.params : {};
    if (m.method === "ui/notifications/tool-result" && "structuredContent" in params)
      on.result(params.structuredContent);
    if (m.method === "ui/notifications/host-context-changed") {
      const theme = themeOf(params.theme);
      if (theme) on.theme(theme);
    }
  });

  // ChatGPT also publishes its globals; whichever bridge answers first fills the widget.
  window.addEventListener("openai:set_globals", (event) => {
    const globals = record((event as CustomEvent).detail)
      ? ((event as CustomEvent).detail as Json).globals
      : undefined;
    if (!record(globals)) return;
    if ("toolOutput" in globals && globals.toolOutput) on.result(globals.toolOutput);
    const theme = themeOf(globals.theme);
    if (theme) on.theme(theme);
  });
  const early = openai();
  if (early?.toolOutput) on.result(early.toolOutput);
  const earlyTheme = themeOf(early?.theme);
  if (earlyTheme) on.theme(earlyTheme);

  if (window.parent !== window) {
    request(
      "ui/initialize",
      {
        protocolVersion: PROTOCOL,
        appInfo: { name: "atelier-velune", version: "1.0.0" },
        appCapabilities: {},
      },
      2000,
    )
      .then((result) => {
        standard = true;
        notify("ui/notifications/initialized", {});
        const context = record(result) && record(result.hostContext) ? result.hostContext : {};
        const theme = themeOf(context.theme);
        if (theme) on.theme(theme);
      })
      .catch(() => {
        // No MCP Apps host answered: window.openai, if any, carries every call.
      });
    new ResizeObserver(() => {
      // The content's own height: scrollHeight never drops below the frame's, so a bag that
      // shrinks would keep the empty space the host gave it before.
      const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (standard) notify("ui/notifications/size-changed", { height });
      openai()?.notifyIntrinsicHeight?.(height);
    }).observe(document.body);
  }

  let memory: Json = record(early?.widgetState) ? early.widgetState : {};
  const unavailable = () => Promise.reject(new Error("This host cannot run the store's tools"));

  return {
    async call(name, args) {
      const result = standard
        ? await request("tools/call", { name, arguments: args }, 90_000)
        : await (openai()?.callTool?.(name, args) ?? unavailable());
      return record(result) ? (result as CallResult) : {};
    },
    async say(text) {
      if (standard)
        await request("ui/message", { role: "user", content: [{ type: "text", text }] }, 10_000);
      else await (openai()?.sendFollowUpMessage?.({ prompt: text }) ?? unavailable());
    },
    async open(url) {
      if (standard) await request("ui/open-link", { url }, 10_000);
      else await (openai()?.openExternal?.({ href: url }) ?? unavailable());
    },
    tellModel(text) {
      if (standard)
        request("ui/update-model-context", { content: [{ type: "text", text }] }, 10_000).catch(
          () => undefined,
        );
      else void openai()?.setWidgetState?.({ ...memory, summary: text });
    },
    remember(state) {
      memory = { ...memory, ...state };
      void openai()?.setWidgetState?.(memory);
    },
    recalled: () => memory,
  };
}

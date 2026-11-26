// Spec: knowledge/components/ask-agent.md
// The panel's pure parts, tested without a browser: reading the answer stream, the words shown
// while it runs, which messages and widgets are drawn, and the MCP Apps host's replies to a widget.

import { openablePage } from "../../lib/storePages";

type Json = Record<string, unknown>;
const record = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export type Widget = { resourceUri: string; structuredContent: unknown };
export type AskMessage = {
  role: "shopper" | "assistant" | "note";
  text: string;
  widgets: Widget[];
  at: number;
};
export type Mode = "normal" | "strict";
export type SessionView = {
  available: boolean;
  state: "active" | "ended" | "locked" | "none";
  reason?: string;
  endsAt?: number;
  mode?: Mode;
  signedIn: boolean;
  accountEmail?: string;
  connected: boolean;
  voice: { available: boolean; unlocked: boolean };
  messages: AskMessage[];
};
export type StreamEvent =
  | { type: "stage"; stage: string }
  | { type: "tool"; name: string; phase: "start" | "end"; label?: string }
  | { type: "final"; text: string; widgets: Widget[]; page?: string; mode: Mode; endsAt: number }
  | { type: "error"; error: string };

// Server-sent events from a fetch body: complete blocks are returned, the unfinished tail is kept.
export function parseEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let type = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!["stage", "tool", "final", "error"].includes(type)) continue;
    try {
      const parsed: unknown = JSON.parse(data.join("\n"));
      if (record(parsed)) events.push({ ...parsed, type } as StreamEvent);
    } catch {
      // A torn or foreign block is skipped; the stream's final or error still settles the turn.
    }
  }
  return { events, rest };
}

// Progress only: the shopper sees that a stage runs, never what it decided.
export function stageLabel(stage: string): string {
  if (stage === "agent") return "Thinking…";
  if (stage === "output") return "Finishing…";
  return "Reading your message…";
}

const ENDED: Record<string, string> = {
  time: "This conversation reached its time limit.",
  idle: "This conversation ended after a quiet while.",
  messages: "This conversation reached its message limit.",
  budget: "This conversation reached its limit.",
  signed_out: "You signed out, so this conversation ended.",
  other_customer: "Another account signed in, so this conversation ended.",
  ended_by_shopper: "You ended this conversation.",
  ended_by_console: "The store ended this conversation.",
};
export const endedText = (reason: string | undefined) =>
  (reason && ENDED[reason]) || "This conversation has ended.";

// Widget taps leave a transcript note for the owner; the shopper already saw the tap.
export const shownMessages = (messages: AskMessage[]) =>
  messages.filter((m) => m.role !== "note" || !m.text.startsWith("Widget:"));

// One widget of a kind per message: a second carousel in the same answer replaces the first.
export const distinctWidgets = (widgets: Widget[]) => [
  ...new Map(widgets.map((w) => [w.resourceUri, w])).values(),
];

export const widgetName = (uri: string) =>
  uri.includes("cart-checkout") ? "Your bag" : "The collection";
export const widgetLine = (uri: string) =>
  uri.includes("cart-checkout") ? "Bag shown" : "Collection shown";

export const CAROUSEL_URI = "ui://widget/product-carousel-v2.html";
export const BAG_URI = "ui://widget/cart-checkout-v2.html";
const CATALOG_TOOLS = new Set(["search_catalog", "get_product", "lookup_catalog"]);
// Which view a tool's answer belongs to, for the widget's own taps.
export const widgetOfTool = (name: string) => (CATALOG_TOOLS.has(name) ? CAROUSEL_URI : BAG_URI);

export type Fed = Widget & { at: number };

// The conversation's one widget: it sits under the newest message that showed one, loads the
// first resource the conversation showed (both run the same script), and is fed the newest
// collection and the newest bag, whether the agent or a tap brought them, oldest first, so it
// ends on the newest view. `at` stays on each item: with the kind it names the item across
// reloads of the transcript, which give new objects for the same data.
export function oneWidget(
  messages: AskMessage[],
  taps: Fed[],
): { home: number; uri: string; feed: Fed[] } | undefined {
  let home = -1;
  let uri: string | undefined;
  const fed: Fed[] = [];
  messages.forEach((m, i) => {
    for (const w of distinctWidgets(m.widgets)) {
      home = i;
      uri ??= w.resourceUri;
      fed.push({ ...w, at: m.at });
    }
  });
  if (home < 0 || !uri) return undefined;
  const newest = new Map<string, Fed>();
  for (const w of [...fed, ...taps]) {
    const known = newest.get(w.resourceUri);
    if (!known || w.at >= known.at) newest.set(w.resourceUri, w);
  }
  const feed = [...newest.values()].sort((a, b) => a.at - b.at);
  return { home, uri, feed };
}
export const fedKey = (item: Fed) => `${item.resourceUri}@${item.at}`;

// The checkout the newest bag shows, when the store still needs a receipt email for it.
export function receiptNeeded(feed: Widget[]): string | undefined {
  const bag = feed.filter((w) => w.resourceUri === BAG_URI).at(-1)?.structuredContent;
  if (!record(bag) || typeof bag.id !== "string" || !bag.id.startsWith("chk_")) return undefined;
  if (bag.status === "completed" || bag.status === "canceled") return undefined;
  const messages = Array.isArray(bag.messages) ? bag.messages : [];
  return messages.some((m) => record(m) && m.code === "missing_buyer_email") ? bag.id : undefined;
}

export type BagLine = { variantId: string; quantity: number };
export type SiteBag = { lines: BagLine[]; checkoutId?: string; paid: boolean; key: string };

// What the site's bag becomes when the widget's newest bag changes: its lines while open, nothing
// once paid; a canceled bag changes nothing. `key` tells a new bag from one already followed.
export function siteBagOf(feed: Widget[]): SiteBag | undefined {
  const bag = feed.filter((w) => w.resourceUri === BAG_URI).at(-1)?.structuredContent;
  if (!record(bag) || typeof bag.id !== "string" || bag.status === "canceled") return undefined;
  const checkoutId = bag.id.startsWith("chk_") ? bag.id : undefined;
  const paid = bag.status === "completed";
  const lines = paid
    ? []
    : (Array.isArray(bag.line_items) ? bag.line_items : []).flatMap((l) =>
        record(l) &&
        record(l.item) &&
        typeof l.item.id === "string" &&
        Number.isInteger(l.quantity) &&
        (l.quantity as number) > 0
          ? [{ variantId: l.item.id, quantity: l.quantity as number }]
          : [],
      );
  return { lines, checkoutId, paid, key: JSON.stringify([bag.id, paid, lines]) };
}

export const sameLines = (a: BagLine[], b: BagLine[]) =>
  a.length === b.length &&
  a.every((l, i) => l.variantId === b[i]?.variantId && l.quantity === b[i]?.quantity);

// The sizes a widget may ask for: never a zero-height frame, never one taller than the panel.
export const clampHeight = (height: unknown) =>
  typeof height === "number" && Number.isFinite(height)
    ? Math.min(900, Math.max(120, Math.ceil(height)))
    : undefined;

// The store's own pages only, as a path the panel's router can open in place.
export function storePath(url: unknown, origins: string[]): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    // A path the parser collapsed to "//" would leave the store once the router reads it.
    if (!origins.includes(parsed.origin) || parsed.pathname.startsWith("//")) return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

// Chromium refuses an opaque-origin frame's requests to a loopback store, so the host hands the
// widget the store's own pictures as data URLs. `load` gets a path on this page's origin; a picture
// it cannot load, or one past the cap, keeps its address.
const ART = /^\/api\/art\/[\w-]+\.svg$/;
export const MAX_INLINE_IMAGES = 64;
export async function inlineImages(
  data: unknown,
  storeOrigin: string,
  load: (path: string) => Promise<string | undefined>,
): Promise<unknown> {
  const found = new Map<string, string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      const path = v.startsWith(`${storeOrigin}/`) ? v.slice(storeOrigin.length) : "";
      if (ART.test(path) && found.size < MAX_INLINE_IMAGES) found.set(v, path);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (record(v)) Object.values(v).forEach(visit);
  };
  visit(data);
  if (!found.size) return data;
  const loaded = new Map<string, string>();
  await Promise.all(
    [...found].map(async ([url, path]) => {
      const inline = await load(path).catch(() => undefined);
      if (inline) loaded.set(url, inline);
    }),
  );
  const swap = (v: unknown): unknown => {
    if (typeof v === "string") return loaded.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (record(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return swap(data);
}

// Light Markdown (the agent's prompt asks for it) as data, drawn by React: no HTML is ever parsed.
// `at` is where a piece starts in the text (or its line), a stable key for React.
export type Inline =
  | { kind: "text" | "strong" | "em" | "code"; text: string; at: number }
  | { kind: "link"; text: string; href: string; at: number };
export type Item = { at: number; inline: Inline[] };
export type Block =
  | { kind: "p"; at: number; inline: Inline[] }
  | { kind: "h"; at: number; inline: Inline[] }
  | { kind: "ul" | "ol"; at: number; items: Item[] };

// A link opens in place only to a page open_page may open (spec invariant 21): another site, a
// protocol-relative "//" or "/\", dot segments that collapse into one, the owner's pages, a query
// the list does not name and any other scheme stay plain text.
export const linkPath = (href: string, origin: string) => openablePage(href, origin);

const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?\s*\)|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<!\w)_([^_\n]+)_(?!\w)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

export function inlines(text: string, origin: string): Inline[] {
  const out: Inline[] = [];
  const link = (label: string, href: string, at: number): Inline => {
    const path = linkPath(href, origin);
    return path ? { kind: "link", text: label, href: path, at } : { kind: "text", text: label, at };
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at), at: last });
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1], at });
    else if (m[2] !== undefined && m[3] !== undefined) out.push(link(m[2], m[3], at));
    else if (m[4] !== undefined) out.push({ kind: "strong", text: m[4], at });
    else if (m[5] !== undefined || m[6] !== undefined)
      out.push({ kind: "em", text: m[5] ?? m[6] ?? "", at });
    else if (m[7] !== undefined) out.push(link(m[7], m[7], at));
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last), at: last });
  return out;
}

export function blocks(text: string, origin: string): Block[] {
  const out: Block[] = [];
  let paragraph: { at: number; lines: string[] } | undefined;
  let list: { kind: "ul" | "ol"; at: number; items: Item[] } | undefined;
  const flushParagraph = () => {
    if (paragraph)
      out.push({
        kind: "p",
        at: paragraph.at,
        inline: inlines(paragraph.lines.join("\n"), origin),
      });
    paragraph = undefined;
  };
  const flushList = () => {
    if (list) out.push(list);
    list = undefined;
  };
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, at) => {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
      const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
      const item = bullet ?? numbered;
      if (item) {
        flushParagraph();
        const kind = bullet ? "ul" : "ol";
        if (list && list.kind !== kind) flushList();
        list ??= { kind, at, items: [] };
        list.items.push({ at, inline: inlines(item[1] ?? "", origin) });
      } else if (heading) {
        flushParagraph();
        flushList();
        out.push({ kind: "h", at, inline: inlines(heading[1] ?? "", origin) });
      } else if (!line.trim()) {
        flushParagraph();
        flushList();
      } else {
        flushList();
        paragraph ??= { at, lines: [] };
        paragraph.lines.push(line);
      }
    });
  flushParagraph();
  flushList();
  return out;
}

export const HOST_PROTOCOL = "2026-01-26";
export type ToolAnswer = { result?: unknown; error?: string };
export type HostDeps = {
  call(name: string, args: Json): Promise<ToolAnswer>;
  open(url: unknown): boolean;
  theme(): "light" | "dark";
  resize(height: number): void;
  initialized(): void;
};

const failure = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

// One message from the widget frame: the JSON-RPC answer to post back, or undefined for a
// notification. Only the requests the panel host offers are answered with a result.
export async function hostReply(message: unknown, deps: HostDeps): Promise<Json | undefined> {
  if (!record(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return undefined;
  const params = record(message.params) ? message.params : {};
  const { id } = message;
  const isRequest = typeof id === "number" || typeof id === "string";
  switch (message.method) {
    case "ui/notifications/initialized":
      deps.initialized();
      return undefined;
    case "ui/notifications/size-changed": {
      const height = clampHeight(params.height);
      if (height) deps.resize(height);
      return undefined;
    }
  }
  if (!isRequest) return undefined;
  const ok = (result: Json) => ({ jsonrpc: "2.0", id, result });
  switch (message.method) {
    case "ui/initialize":
      return ok({
        protocolVersion: HOST_PROTOCOL,
        hostInfo: { name: "atelier-velune-ask", version: "1.0.0" },
        hostCapabilities: { openLinks: {}, serverTools: {} },
        hostContext: { theme: deps.theme(), displayMode: "inline", platform: "web" },
      });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") return failure(id, -32602, "A tool name is needed.");
      const answer = await deps.call(name, record(params.arguments) ? params.arguments : {});
      if (record(answer.result)) return ok(answer.result);
      return failure(id, -32000, answer.error ?? "The store could not do that.");
    }
    // ui/message is not offered: a widget never writes to the agent (spec invariant 17).
    case "ui/open-link":
      return deps.open(params.url) ? ok({}) : failure(id, -32000, "Only the store's pages open.");
    case "ui/update-model-context":
      // The agent reads the bag through get_cart; a widget's summary is not needed.
      return ok({});
    default:
      return failure(id, -32601, "Not offered by this host.");
  }
}

// The voice call's data channel: captions and the call's start and end, nothing else is read.
export type VoiceEvent =
  | { kind: "started" }
  | { kind: "caption"; who: "you" | "assistant"; delta: string }
  | { kind: "closed"; reason?: string };

export function voiceEvent(raw: unknown): VoiceEvent | undefined {
  let event: unknown;
  try {
    event = JSON.parse(String(raw));
  } catch {
    return undefined;
  }
  if (!record(event) || typeof event.type !== "string") return undefined;
  if (event.type === "session.started") return { kind: "started" };
  if (event.type === "session.closed")
    return { kind: "closed", reason: typeof event.reason === "string" ? event.reason : undefined };
  if (typeof event.delta !== "string") return undefined;
  if (event.type === "session.input_transcript.delta")
    return { kind: "caption", who: "you", delta: event.delta };
  if (event.type === "session.output_transcript.delta")
    return { kind: "caption", who: "assistant", delta: event.delta };
  return undefined;
}

export type Caption = { who: "you" | "assistant"; text: string };
const CAPTION_MAX = 180;

// One line per speaker turn: a delta from the same speaker extends it, the other speaker starts anew.
export function nextCaption(previous: Caption | undefined, who: Caption["who"], delta: string) {
  const text = previous?.who === who ? previous.text + delta : delta.trimStart();
  return { who, text: text.length > CAPTION_MAX ? `…${text.slice(-CAPTION_MAX)}` : text };
}

export const clockText = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// The panel is closed, open, or minimised to a bar that keeps the answer, the voice call and the
// widget running (spec Panel).
export type PanelState = "closed" | "open" | "minimised";

// The site header's Ask button never stops anything: it opens a closed or minimised panel and
// minimises an open one.
export const launcherNext = (state: PanelState): PanelState =>
  state === "open" ? "minimised" : "open";

// After the agent opens a page, the panel steps aside below 1024 px so the page shows; from 1024
// px it is docked beside the page and stays.
export const afterPage = (state: PanelState, docks: boolean): PanelState =>
  state === "open" && !docks ? "minimised" : state;

export const savedState = (value: string | null): PanelState =>
  value === "1" ? "open" : value === "min" ? "minimised" : "closed";

// The start of the last answer, as plain words for the minimised bar.
export function preview(messages: AskMessage[]): string | undefined {
  const last = messages.filter((m) => m.role === "assistant").at(-1);
  if (!last) return undefined;
  return last.text
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

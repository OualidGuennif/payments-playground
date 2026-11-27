"use client";
// Spec: knowledge/components/ask-agent.md
// An MCP Apps host for one widget: a sandboxed srcdoc frame (scripts only, opaque origin, no
// connection) that reaches the store only through this host, which sends its taps to
// /api/ask/widget as the session's own identity; the widget never writes to the agent.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { readCart } from "@/lib/client";
import { onThemeChange, resolvedTheme } from "@/lib/theme";
import { askCall } from "./askClient";
import {
  type Fed,
  fedKey,
  hostReply,
  inlineImages,
  joinSiteBag,
  storePath,
  type ToolAnswer,
  widgetName,
  widgetOfTool,
} from "./askLogic";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Frame = { html: string; storeOrigin: string };
const frames = new Map<string, Promise<Frame | undefined>>();

// One fetch per widget kind and page load; the HTML is the same for every message.
function frameFor(uri: string) {
  let pending = frames.get(uri);
  if (!pending) {
    pending = askCall<Frame>(`/widget-frame?uri=${encodeURIComponent(uri)}`).then((a) => {
      if (!a.data) frames.delete(uri);
      return a.data;
    });
    frames.set(uri, pending);
  }
  return pending;
}

// One fetch per picture and page load, from this page's own origin; a failure is tried again later.
const pictures = new Map<string, Promise<string | undefined>>();
function picture(path: string) {
  let pending = pictures.get(path);
  if (!pending) {
    pending = fetch(path)
      .then(async (response) => {
        const blob = await response.blob();
        if (!response.ok || !blob.type.startsWith("image/")) return undefined;
        return await new Promise<string | undefined>((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === "string" ? reader.result : undefined);
          reader.onerror = () => resolve(undefined);
          reader.readAsDataURL(blob);
        });
      })
      .catch(() => undefined)
      .then((inline) => {
        if (!inline) pictures.delete(path);
        return inline;
      });
    pictures.set(path, pending);
  }
  return pending;
}

// One bag per browser: a cart the widget starts with no bag of its own joins the site's lines.
function withSiteBag(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name !== "create_cart" || !record(args.cart)) return args;
  const lineItems = joinSiteBag(readCart(), args.cart.line_items);
  return lineItems ? { ...args, cart: { ...args.cart, line_items: lineItems } } : args;
}

// An opaque-origin frame can only be addressed with "*". This frame only ever holds the store's own
// widget (no link, form, HTML sink or navigation in it, CSP default-src 'none', spec invariant 17),
// so what is posted (its own data and theme, never a secret) cannot reach another document.
const postTo = (frame: HTMLIFrameElement | null, message: Record<string, unknown>) =>
  // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
  frame?.contentWindow?.postMessage(message, "*");

// The conversation's one widget (spec Panel): each data in `feed` it has not had yet is sent in
// order, its pictures inlined; a tap's answer is handed back through `onResult` so the panel keeps
// it when the widget moves under a newer message.
export function WidgetFrame({
  uri,
  feed,
  onResult,
  onOpen,
}: {
  uri: string;
  feed: Fed[];
  onResult: (fed: Fed) => void;
  // The panel opens a store page the way it opens an answer's (it steps aside on a phone).
  onOpen?: (path: string) => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLIFrameElement>(null);
  const [frame, setFrame] = useState<Frame>();
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(320);
  const ready = useRef(false);
  const origin = useRef<string>(undefined);
  const latest = useRef(feed);
  const sent = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const handBack = useRef(onResult);
  useEffect(() => {
    handBack.current = onResult;
  }, [onResult]);
  const opener = useRef(onOpen);
  useEffect(() => {
    opener.current = onOpen;
  }, [onOpen]);

  const push = useCallback(() => {
    const store = origin.current;
    if (!ready.current || !store) return;
    for (const item of latest.current) {
      if (sent.current.has(fedKey(item))) continue;
      sent.current.add(fedKey(item));
      queue.current = queue.current.then(async () => {
        const structuredContent = await inlineImages(item.structuredContent, store, picture);
        postTo(ref.current, {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent },
        });
      });
    }
  }, []);

  useEffect(() => {
    let live = true;
    void frameFor(uri).then((f) => {
      if (!live) return;
      if (f) setFrame(f);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [uri]);

  useEffect(() => {
    const target = ref.current;
    if (!frame || !target) return;
    origin.current = frame.storeOrigin;
    const post = (message: Record<string, unknown>) => postTo(target, message);
    const origins = [window.location.origin, frame.storeOrigin];
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target.contentWindow) return;
      void hostReply(event.data, {
        call: async (name, args): Promise<ToolAnswer> => {
          const answer = await askCall<{ result: unknown }>("/widget", {
            name,
            arguments: withSiteBag(name, args),
          });
          if (!answer.data) return { error: answer.message };
          const result = answer.data.result;
          // The frame shows this answer itself; the panel keeps it as the newest of its view.
          if (record(result) && result.isError !== true && result.structuredContent !== undefined) {
            const fed: Fed = {
              resourceUri: widgetOfTool(name),
              structuredContent: result.structuredContent,
              at: Date.now(),
            };
            sent.current.add(fedKey(fed));
            handBack.current(fed);
          }
          return { result: await inlineImages(result, frame.storeOrigin, picture) };
        },
        open: (url) => {
          const path = storePath(url, origins);
          if (path) (opener.current ?? router.push)(path);
          return Boolean(path);
        },
        theme: resolvedTheme,
        resize: setHeight,
        initialized: () => {
          ready.current = true;
          push();
        },
      }).then((reply) => {
        if (reply) post(reply);
      });
    };
    // The header's theme switch changes data-theme without a reload: the widget follows at once.
    const stopTheme = onThemeChange(() =>
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme: resolvedTheme() },
      }),
    );
    window.addEventListener("message", onMessage);
    return () => {
      stopTheme();
      window.removeEventListener("message", onMessage);
    };
  }, [frame, router, push]);

  // Newer data, from the agent or a tap the panel kept, is pushed in place.
  useEffect(() => {
    latest.current = feed;
    push();
  }, [feed, push]);

  const title = widgetName(feed.at(-1)?.resourceUri ?? uri);
  if (failed) return <p className="p-3.5 text-xs text-muted">{title} could not be shown here.</p>;
  if (!frame)
    return (
      <div
        className="h-40 animate-pulse bg-line/40 motion-reduce:animate-none"
        role="status"
        aria-label={`Loading ${title.toLowerCase()}`}
      />
    );
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      srcDoc={frame.html}
      height={height}
      className="block w-full bg-card"
    />
  );
}

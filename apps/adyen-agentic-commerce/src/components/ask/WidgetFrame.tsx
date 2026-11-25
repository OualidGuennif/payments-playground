"use client";
// Spec: knowledge/components/ask-agent.md
// An MCP Apps host for one widget: a sandboxed srcdoc frame (scripts only, opaque origin, no
// connection) that reaches the store only through this host, which sends its taps to
// /api/ask/widget as the session's own identity and its messages through the full pipeline.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { askCall } from "./askClient";
import {
  hostReply,
  inlineImages,
  storePath,
  type ToolAnswer,
  type Widget,
  widgetName,
} from "./askLogic";

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

const theme = (): "light" | "dark" =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function WidgetFrame({
  widget,
  onSay,
}: {
  widget: Widget;
  onSay: (text: string) => Promise<string | undefined>;
}) {
  const router = useRouter();
  const ref = useRef<HTMLIFrameElement>(null);
  const [frame, setFrame] = useState<Frame>();
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(320);
  // The newest data for the frame, its pictures inlined, sent once it finishes its handshake.
  const data = useRef<Promise<unknown>>(undefined);
  const ready = useRef(false);
  const sendResult = useCallback(() => {
    const pending = data.current;
    void pending?.then((structuredContent) => {
      if (pending !== data.current || !ready.current) return;
      ref.current?.contentWindow?.postMessage(
        { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent } },
        "*",
      );
    });
  }, []);
  const say = useRef(onSay);
  useEffect(() => {
    say.current = onSay;
  }, [onSay]);

  useEffect(() => {
    let live = true;
    void frameFor(widget.resourceUri).then((f) => {
      if (!live) return;
      if (f) setFrame(f);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [widget.resourceUri]);

  useEffect(() => {
    const target = ref.current;
    if (!frame || !target) return;
    // An opaque-origin frame can only be addressed with "*"; what is posted is the widget's own
    // data and theme, never a secret.
    const post = (message: Record<string, unknown>) =>
      target.contentWindow?.postMessage(message, "*");
    const origins = [window.location.origin, frame.storeOrigin];
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target.contentWindow) return;
      void hostReply(event.data, {
        call: async (name, args): Promise<ToolAnswer> => {
          const answer = await askCall<{ result: unknown }>("/widget", { name, arguments: args });
          if (!answer.data) return { error: answer.message };
          return { result: await inlineImages(answer.data.result, frame.storeOrigin, picture) };
        },
        say: (text) => say.current(text),
        open: (url) => {
          const path = storePath(url, origins);
          if (path) router.push(path);
          return Boolean(path);
        },
        theme,
        resize: setHeight,
        initialized: () => {
          ready.current = true;
          sendResult();
        },
      }).then((reply) => {
        if (reply) post(reply);
      });
    };
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () =>
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme: theme() },
      });
    window.addEventListener("message", onMessage);
    scheme.addEventListener("change", onScheme);
    return () => {
      window.removeEventListener("message", onMessage);
      scheme.removeEventListener("change", onScheme);
    };
  }, [frame, router, sendResult]);

  // New data for a frame already showing (the same widget answered again) is pushed in place.
  useEffect(() => {
    if (!frame) return;
    data.current = inlineImages(widget.structuredContent, frame.storeOrigin, picture);
    sendResult();
  }, [frame, widget.structuredContent, sendResult]);

  const title = widgetName(widget.resourceUri);
  if (failed) return <p className="text-xs text-muted">{title} could not be shown here.</p>;
  if (!frame)
    return (
      <div
        className="h-40 animate-pulse rounded-xl border border-line bg-line/40 motion-reduce:animate-none"
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
      className="block w-full rounded-xl border border-line bg-card"
    />
  );
}

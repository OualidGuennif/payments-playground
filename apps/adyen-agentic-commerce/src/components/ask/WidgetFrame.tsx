"use client";
// Spec: knowledge/components/ask-agent.md
// An MCP Apps host for one widget: a sandboxed srcdoc frame (scripts only, opaque origin, no
// connection) that reaches the store only through this host, which sends its taps to
// /api/ask/widget as the session's own identity and its messages through the full pipeline.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { askCall } from "./askClient";
import { hostReply, storePath, type ToolAnswer, type Widget, widgetName } from "./askLogic";

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
  // The newest data for the frame, read when it finishes its handshake.
  const data = useRef(widget.structuredContent);
  const ready = useRef(false);
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
    const sendResult = () =>
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { structuredContent: data.current },
      });
    const origins = [window.location.origin, frame.storeOrigin];
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target.contentWindow) return;
      void hostReply(event.data, {
        call: async (name, args): Promise<ToolAnswer> => {
          const answer = await askCall<{ result: unknown }>("/widget", { name, arguments: args });
          return answer.data ? { result: answer.data.result } : { error: answer.message };
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
  }, [frame, router]);

  // New data for a frame already showing (the same widget answered again) is pushed in place.
  useEffect(() => {
    data.current = widget.structuredContent;
    if (ready.current)
      ref.current?.contentWindow?.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { structuredContent: widget.structuredContent },
        },
        "*",
      );
  }, [widget.structuredContent]);

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

"use client";
// Spec: knowledge/components/ask-agent.md
// The shopper's assistant: a right sidebar on wide screens (the page makes room), a sheet on
// phones, full screen on demand. It shows what the server answers and nothing more: no score,
// verdict, model or cost ever reaches it.
import { usePathname } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AskConnect } from "./AskConnect";
import { Icon } from "./AskIcon";
import { AskText } from "./AskText";
import { AskVoice } from "./AskVoice";
import { askCall, sendMessage, setAskOpen, useAskOpen, wasAskOpen } from "./askClient";
import {
  type AskMessage,
  distinctWidgets,
  endedText,
  liveWidgets,
  type SessionView,
  shownMessages,
  stageLabel,
  widgetName,
} from "./askLogic";
import { WidgetFrame } from "./WidgetFrame";

// Pages where the assistant has no place: the owner's tools and the consent screens.
const HIDDEN = ["/console", "/back-office", "/consent", "/device", "/oauth"];
const hiddenOn = (path: string) => HIDDEN.some((p) => path === p || path.startsWith(`${p}/`));
const MAX_CHARS = 1000;
const SUGGESTIONS = [
  "Show me the collection",
  "What goes with the wide-leg wool trousers?",
  "Find me a gift for a weekend away",
];

const SPARK =
  "M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z";
const EXPAND = "M14 4h6v6 M10 20H4v-6 M20 4l-7 7 M4 20l7-7";
const COLLAPSE = "M4 14h6v6 M20 10h-6V4 M10 14l-7 7 M14 10l7-7";
const CLOSE = "M6 6l12 12 M18 6L6 18";
const NEW = "M12 5v14 M5 12h14";
const SEND = "M12 19V5 M6 11l6-6 6 6";

export function AskLauncher() {
  const pathname = usePathname();
  const open = useAskOpen();
  if (hiddenOn(pathname)) return null;
  return (
    <button
      type="button"
      id="ask-launcher"
      className="btn-ghost w-11 gap-1.5 px-0 py-1.5 sm:w-auto sm:px-3"
      aria-expanded={open}
      aria-controls="ask-panel"
      onClick={() => setAskOpen(!open)}
    >
      <Icon d={SPARK} />
      <span className="sr-only sm:not-sr-only">Ask</span>
    </button>
  );
}

function Bubble({
  message,
  live,
  index,
  onSay,
}: {
  message: AskMessage;
  live: Set<string>;
  index: number;
  onSay: (text: string) => Promise<string | undefined>;
}) {
  if (message.role === "note")
    return <li className="text-center text-xs text-muted">{message.text}</li>;
  if (message.role === "shopper")
    return (
      <li className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-paper [overflow-wrap:anywhere]">
        <span className="sr-only">You: </span>
        {message.text}
      </li>
    );
  return (
    <li className="space-y-3">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-card px-3.5 py-2.5">
        <span className="sr-only">Assistant: </span>
        <AskText text={message.text} />
      </div>
      {distinctWidgets(message.widgets).map((widget) =>
        live.has(`${index}:${widget.resourceUri}`) ? (
          <WidgetFrame key={widget.resourceUri} widget={widget} onSay={onSay} />
        ) : (
          <p key={widget.resourceUri} className="text-xs text-muted">
            {widgetName(widget.resourceUri)}, shown again below.
          </p>
        ),
      )}
    </li>
  );
}

export function AskPanel() {
  const pathname = usePathname();
  const open = useAskOpen();
  const [wide, setWide] = useState(false);
  const [view, setView] = useState<SessionView>();
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [status, setStatus] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState("");
  const [calling, setCalling] = useState(false);
  const busy = useRef(false);
  const viewNow = useRef<SessionView>(undefined);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewNow.current = view;
  }, [view]);

  useEffect(() => {
    if (wasAskOpen()) setAskOpen(true);
  }, []);

  // Reads the session; the transcript is replaced only when asked (opening, a new page).
  const load = useCallback(async (withMessages: boolean) => {
    const answer = await askCall<SessionView>("/session");
    if (!answer.data) {
      setNotice(answer.message);
      return;
    }
    setView(answer.data);
    if (withMessages) setMessages(answer.data.messages);
  }, []);

  // Opening, and every page change while open: signing in or out changes the session.
  useEffect(() => {
    if (open && pathname && !busy.current) void load(true);
  }, [open, pathname, load]);

  // During a voice call the conversation fills from the server: each voiced turn is a message.
  useEffect(() => {
    if (!calling) return;
    const timer = setInterval(() => void load(true), 3_000);
    return () => {
      clearInterval(timer);
      void load(true);
    };
  }, [calling, load]);

  // The page makes room for the docked panel on wide screens (globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (open && !wide && !hiddenOn(pathname)) root.dataset.ask = "docked";
    else delete root.dataset.ask;
    return () => {
      delete root.dataset.ask;
    };
  }, [open, wide, pathname]);

  useEffect(() => {
    if (!open) return;
    if (window.matchMedia("(min-width: 768px)").matches) input.current?.focus();
    else panel.current?.focus();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new message or status.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const close = () => {
    setAskOpen(false);
    setWide(false);
    document.getElementById("ask-launcher")?.focus();
  };

  const startNew = useCallback(async (): Promise<string | undefined> => {
    const answer = await askCall<SessionView>("/session", {});
    if (!answer.data) {
      setNotice(answer.message);
      return answer.message;
    }
    setView(answer.data);
    setMessages([]);
    setNotice(undefined);
    return undefined;
  }, []);

  // One message through the whole pipeline; the answer streams its progress, then one final.
  const send = useCallback(
    async (raw: string): Promise<string | undefined> => {
      const text = raw.trim().slice(0, MAX_CHARS);
      if (!text) return "Write a message first.";
      if (busy.current) return "The assistant is still answering.";
      busy.current = true;
      setNotice(undefined);
      if (viewNow.current?.state === "ended") {
        const refused = await startNew();
        if (refused) {
          busy.current = false;
          return refused;
        }
      }
      const at = Date.now();
      setMessages((m) => [...m, { role: "shopper", text, widgets: [], at }]);
      setStatus(stageLabel("gate"));
      let settled = false;
      const answer = await sendMessage(text, pathname, (event) => {
        if (event.type === "stage") setStatus(stageLabel(event.stage));
        else if (event.type === "tool" && event.phase === "start")
          setStatus(event.label ?? "Asking the store…");
        else if (event.type === "final") {
          settled = true;
          setMessages((m) => [
            ...m,
            { role: "assistant", text: event.text, widgets: event.widgets, at: Date.now() },
          ]);
        } else if (event.type === "error") {
          settled = true;
          setNotice("The assistant could not answer this time. Please try again.");
        }
      });
      busy.current = false;
      setStatus(undefined);
      if (answer.error) {
        // Not taken: the words go back to the composer.
        setMessages((m) => m.filter((x) => !(x.role === "shopper" && x.at === at)));
        setNotice(answer.message);
        if (answer.error === "session_ended" || answer.error === "session_locked")
          setView((v) =>
            v
              ? {
                  ...v,
                  state: answer.error === "session_locked" ? "locked" : "ended",
                  reason: answer.reason,
                }
              : v,
          );
        return answer.message ?? "The message was not sent.";
      }
      if (!settled) setNotice("The assistant could not answer this time. Please try again.");
      void load(false);
      return undefined;
    },
    [pathname, startNew, load],
  );

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft;
    if (!text.trim() || busy.current) return;
    setDraft("");
    if (await send(text)) setDraft(text);
  };

  const onKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  if (!open || hiddenOn(pathname)) return null;

  const shown = shownMessages(messages);
  const live = liveWidgets(shown);
  const unavailable = view !== undefined && !view.available;
  const locked = view?.state === "locked";
  const ended = view?.state === "ended";
  const until =
    view?.state === "active" && view.endsAt
      ? `Open until ${new Date(view.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Answers can be wrong; check before you pay.";
  const canConnect =
    view?.state === "active" && view.signedIn && !view.connected && view.mode === "normal";
  const inner = wide ? "mx-auto w-full max-w-3xl" : "";

  return (
    <>
      {!wide && (
        <button
          type="button"
          aria-label="Close the assistant"
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-ink/30 md:hidden"
          onClick={close}
        />
      )}
      <aside
        id="ask-panel"
        ref={panel}
        tabIndex={-1}
        aria-labelledby="ask-title"
        onKeyDown={(e) => e.key === "Escape" && close()}
        className={`fixed z-40 flex flex-col bg-paper shadow-2xl outline-none ${
          wide
            ? "inset-0"
            : "inset-x-0 bottom-0 h-[88dvh] rounded-t-3xl border-t border-line md:inset-x-auto md:top-0 md:right-0 md:h-dvh md:w-[420px] md:rounded-none md:border-t-0 md:border-l"
        }`}
      >
        <header className="border-b border-line px-4 py-3">
          <div className={`flex items-center gap-1 ${inner}`}>
            <div className="min-w-0 flex-1">
              <h2 id="ask-title" className="font-serif text-lg leading-tight">
                Ask Atelier Velune
              </h2>
              <p className="truncate text-xs text-muted">
                {view?.connected ? "Connected to your account · " : ""}
                {until}
              </p>
            </div>
            {shown.length > 0 && !locked && (
              <button
                type="button"
                className="grid size-11 place-items-center rounded-full hover:bg-line/60 disabled:opacity-40"
                onClick={() => void startNew()}
                disabled={status !== undefined}
                title="New conversation"
              >
                <Icon d={NEW} label="New conversation" />
              </button>
            )}
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full hover:bg-line/60"
              onClick={() => setWide(!wide)}
              aria-pressed={wide}
              title={wide ? "Leave full screen" : "Full screen"}
            >
              <Icon d={wide ? COLLAPSE : EXPAND} label="Full screen" />
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full hover:bg-line/60"
              onClick={close}
              title="Close"
            >
              <Icon d={CLOSE} label="Close the assistant" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <div className={`space-y-4 ${inner}`}>
            {shown.length === 0 && (
              <div className="space-y-3 pt-2">
                <p className="eyebrow">Your stylist and shop assistant</p>
                <p className="font-serif text-2xl leading-snug">
                  Find a piece, check a size, fill your bag.
                </p>
                <p className="text-sm text-muted">
                  It shops this store with you and hands you the checkout to pay; signed in, you may
                  let it pay with a saved card. Adyen TEST: no real money moves.
                </p>
                {!unavailable && !locked && (
                  <ul className="flex flex-wrap gap-2 pt-1">
                    {SUGGESTIONS.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          className="btn-ghost min-h-10 px-3.5 py-1.5 text-left font-normal"
                          onClick={() => void send(s)}
                          disabled={status !== undefined}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <ol role="log" aria-live="polite" aria-label="Conversation" className="space-y-4">
              {shown.map((message, index) => (
                <Bubble
                  key={`${message.role}:${message.at}`}
                  message={message}
                  live={live}
                  index={index}
                  onSay={send}
                />
              ))}
            </ol>
            {status && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <span className="inline-flex gap-1" aria-hidden="true">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms] motion-reduce:animate-none" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms] motion-reduce:animate-none" />
                </span>
                {status}
              </p>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <footer className="border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className={`space-y-2.5 ${inner}`}>
            {unavailable && (
              <p className="text-sm text-bad">The assistant is not available right now.</p>
            )}
            {locked && <p className="text-sm text-bad">The store paused this conversation.</p>}
            {ended && !unavailable && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-muted">{endedText(view?.reason)}</p>
                <button
                  type="button"
                  className="btn-ghost min-h-10 px-4 py-1.5"
                  onClick={() => void startNew()}
                >
                  Start again
                </button>
              </div>
            )}
            {notice && !unavailable && (
              <p role="alert" className="text-sm text-bad">
                {notice}
              </p>
            )}
            {canConnect && <AskConnect onConnected={() => void load(false)} />}
            {view?.state === "active" && (
              <AskVoice view={view} onUnlocked={() => void load(false)} onCalling={setCalling} />
            )}
            <form onSubmit={submit} className="flex items-end gap-2">
              <label className="sr-only" htmlFor="ask-input">
                Message the assistant
              </label>
              <textarea
                id="ask-input"
                ref={input}
                rows={1}
                maxLength={MAX_CHARS}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeys}
                disabled={unavailable || locked || calling}
                placeholder={calling ? "On a voice call…" : "Ask about a piece, a size, your bag…"}
                className="field max-h-40 min-h-11 flex-1 resize-none py-2.5 [field-sizing:content]"
              />
              <button
                type="submit"
                className="btn size-11 shrink-0 px-0"
                disabled={!draft.trim() || status !== undefined || unavailable || locked || calling}
              >
                <Icon d={SEND} label="Send" />
              </button>
            </form>
            {draft.length > MAX_CHARS - 200 && (
              <p className="text-right text-xs text-muted tabular-nums">
                {draft.length} / {MAX_CHARS}
              </p>
            )}
          </div>
        </footer>
      </aside>
    </>
  );
}

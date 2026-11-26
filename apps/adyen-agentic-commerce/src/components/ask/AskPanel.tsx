"use client";
// Spec: knowledge/components/ask-agent.md
// The shopper's assistant: a right sidebar on wide screens (the page makes room), a sheet on
// phones, full screen on demand, or minimised to a bar while the answer, the voice call and the
// widget keep running. It shows what the server answers and nothing more: no score, verdict,
// model or cost ever reaches it.
import { usePathname, useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AskConnect } from "./AskConnect";
import { Icon } from "./AskIcon";
import { AskDelivery } from "./AskDelivery";
import { AskReceipt } from "./AskReceipt";
import { AskText } from "./AskText";
import { MuteButton, useVoice, VoiceButton, VoicePanel } from "./AskVoice";
import { followBag, readCart } from "@/lib/client";
import { openablePage } from "@/lib/storePages";
import {
  askCall,
  askState,
  savedAskState,
  sendMessage,
  setAskState,
  useAskState,
} from "./askClient";
import {
  afterPage,
  type AskMessage,
  distinctWidgets,
  endedText,
  type Fed,
  launcherNext,
  oneWidget,
  preview,
  deliveryCheckout,
  receiptNeeded,
  type SessionView,
  shownMessages,
  siteBagOf,
  stageLabel,
  voicePage,
  widgetLine,
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
const MINIMISE = "M6 9l6 6 6-6";
const RESTORE = "M6 15l6-6 6 6";
const NEW = "M12 5v14 M5 12h14";
const SEND = "M12 19V5 M6 11l6-6 6 6";

export function AskLauncher() {
  const pathname = usePathname();
  const state = useAskState();
  if (hiddenOn(pathname)) return null;
  return (
    <button
      type="button"
      id="ask-launcher"
      className="btn-ghost w-11 gap-1.5 px-0 py-1.5 sm:w-auto sm:px-3"
      aria-expanded={state === "open"}
      aria-controls="ask-panel"
      onClick={() => setAskState(launcherNext(state))}
    >
      <Icon d={SPARK} />
      <span className="sr-only sm:not-sr-only">Ask</span>
    </button>
  );
}

// `widget` is the conversation's one widget when this message is its home; any other message that
// showed one keeps a line saying so.
function Bubble({ message, widget }: { message: AskMessage; widget?: ReactNode }) {
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
      {widget ??
        distinctWidgets(message.widgets).map((w) => (
          <p key={w.resourceUri} className="text-xs text-muted">
            {widgetLine(w.resourceUri)}
          </p>
        ))}
    </li>
  );
}

export function AskPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const state = useAskState();
  const open = state === "open";
  const minimised = state === "minimised";
  const shown = state !== "closed";
  const [wide, setWide] = useState(false);
  const [view, setView] = useState<SessionView>();
  const [messages, setMessages] = useState<AskMessage[]>([]);
  // The widget's own answers (taps, the receipt email), newest per kind, until a new conversation.
  const [taps, setTaps] = useState<Fed[]>([]);
  const [status, setStatus] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState("");
  const busy = useRef(false);
  const viewNow = useRef<SessionView>(undefined);
  const panel = useRef<HTMLElement>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewNow.current = view;
  }, [view]);

  useEffect(() => {
    const saved = savedAskState();
    if (saved !== "closed") setAskState(saved);
  }, []);

  // Reads the session; the transcript is replaced only when asked (opening, a new page).
  const load = useCallback(async (withMessages: boolean) => {
    const answer = await askCall<SessionView>("/session");
    if (!answer.data) {
      setNotice(answer.message);
      return;
    }
    setView(answer.data);
    if (!withMessages) return;
    setMessages(answer.data.messages);
    // An empty transcript is a new or ended conversation: the old widget's taps go with it.
    if (answer.data.messages.length === 0) setTaps([]);
  }, []);

  const onResult = useCallback(
    (fed: Fed) => setTaps((t) => [...t.filter((x) => x.resourceUri !== fed.resourceUri), fed]),
    [],
  );

  // Opening, and every page change while shown: signing in or out changes the session.
  useEffect(() => {
    if (shown && pathname && !busy.current) void load(true);
  }, [shown, pathname, load]);

  // The page makes room for the docked panel on wide screens (globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (open && !wide && !hiddenOn(pathname)) root.dataset.ask = "docked";
    else if (minimised && !hiddenOn(pathname)) root.dataset.ask = "minimised";
    else delete root.dataset.ask;
    return () => {
      delete root.dataset.ask;
    };
  }, [open, minimised, wide, pathname]);

  useEffect(() => {
    if (minimised) restore.current?.focus();
    if (!open) return;
    if (window.matchMedia("(min-width: 768px)").matches) input.current?.focus();
    else panel.current?.focus();
  }, [open, minimised]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new message or status.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const close = () => {
    setAskState("closed");
    setWide(false);
    document.getElementById("ask-launcher")?.focus();
  };

  const minimise = () => {
    setAskState("minimised");
    setWide(false);
  };

  // A page the agent named opens in place once its answer shows, if the browser's own check of
  // the store's pages agrees (spec invariant 21); below 1024 px the panel then steps aside.
  const showPage = useCallback(
    (path: string) => {
      setWide(false);
      const docks = window.matchMedia("(min-width: 1024px)").matches;
      setAskState(afterPage(askState(), docks));
      router.push(path);
    },
    [router],
  );
  const openPage = useCallback(
    (page: string) => {
      const path = openablePage(page, window.location.origin);
      if (path) showPage(path);
    },
    [showPage],
  );

  const startNew = useCallback(async (): Promise<string | undefined> => {
    const answer = await askCall<SessionView>("/session", {});
    if (!answer.data) {
      setNotice(answer.message);
      return answer.message;
    }
    setView(answer.data);
    setMessages([]);
    setTaps([]);
    setNotice(undefined);
    return undefined;
  }, []);

  const voice = useVoice({
    view,
    shown: shown && !hiddenOn(pathname),
    begin: startNew,
    onUnlocked: () => void load(false),
  });
  const calling = voice.calling;

  // A voiced answer's page opens once, as a typed answer's does (spec invariant 21). `callFrom`
  // is the newest stored message's time when the call began, read from the server, whose clock
  // stamps every stored message: nothing older ever opens, and nothing opens before it is known.
  const callFrom = useRef<number>(undefined);
  const openedPages = useRef(new Set<number>());
  useEffect(() => {
    callFrom.current = undefined;
    if (!calling) return;
    let live = true;
    void askCall<SessionView>("/session").then((answer) => {
      if (live && answer.data) callFrom.current = answer.data.messages.at(-1)?.at ?? 0;
    });
    return () => {
      live = false;
    };
  }, [calling]);
  useEffect(() => {
    if (callFrom.current === undefined) return;
    const { page, seen } = voicePage(messages, callFrom.current, openedPages.current);
    for (const at of seen) openedPages.current.add(at);
    if (page) openPage(page);
  }, [messages, openPage]);

  // During a voice call the conversation fills from the server: each voiced turn is a message.
  useEffect(() => {
    if (!calling) return;
    const timer = setInterval(() => void load(true), 3_000);
    return () => {
      clearInterval(timer);
      void load(true);
    };
  }, [calling, load]);

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
      const answer = await sendMessage(
        text,
        pathname,
        (event) => {
          if (event.type === "stage") setStatus(stageLabel(event.stage));
          else if (event.type === "tool" && event.phase === "start")
            setStatus(event.label ?? "Asking the store…");
          else if (event.type === "final") {
            settled = true;
            setMessages((m) => [
              ...m,
              { role: "assistant", text: event.text, widgets: event.widgets, at: Date.now() },
            ]);
            if (event.page) openPage(event.page);
          } else if (event.type === "error") {
            settled = true;
            setNotice("The assistant could not answer this time. Please try again.");
          }
        },
        // The site's bag rides along; the server checks each line against the catalogue.
        readCart(),
      );
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
    [pathname, startNew, load, openPage],
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

  // The site's bag follows the widget's, once per new bag: the tab remembers the last one followed,
  // so a transcript reloaded on another page never undoes a change the shopper made on the site.
  const followed = siteBagOf(oneWidget(shownMessages(messages), taps)?.feed ?? []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names the bag's content.
  useEffect(() => {
    if (!followed) return;
    const KEY = "velune-bag-followed";
    try {
      if (sessionStorage.getItem(KEY) === followed.key) return;
      sessionStorage.setItem(KEY, followed.key);
    } catch {
      /* private mode: follow every time */
    }
    followBag(followed);
  }, [followed?.key]);

  if (!shown || hiddenOn(pathname)) return null;

  const visible = shownMessages(messages);
  const one = oneWidget(visible, taps);
  const receipt = one && view?.state === "active" ? receiptNeeded(one.feed) : undefined;
  const delivery = one && view?.state === "active" ? deliveryCheckout(one.feed) : undefined;
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
      {open && !wide && (
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
        onKeyDown={(event) => event.key === "Escape" && open && minimise()}
        className={`fixed z-40 flex flex-col bg-paper shadow-2xl outline-none ${
          wide
            ? "inset-0"
            : minimised
              ? "inset-x-3 bottom-3 max-h-[60dvh] rounded-2xl border border-line md:inset-x-auto md:right-4 md:bottom-4 md:w-[380px]"
              : "inset-x-0 bottom-0 h-[88dvh] rounded-t-3xl border-t border-line md:inset-x-auto md:top-0 md:right-0 md:h-dvh md:w-[420px] md:rounded-none md:border-t-0 md:border-l"
        }`}
      >
        <header className={`border-b border-line px-4 ${minimised ? "py-2" : "py-3"}`}>
          <div className={`flex items-center gap-1 ${inner}`}>
            <div className="min-w-0 flex-1">
              <h2 id="ask-title" className="font-serif text-lg leading-tight">
                Ask Atelier Velune
                {minimised && <span className="sr-only"> (minimised)</span>}
              </h2>
              {minimised ? (
                <p aria-live="polite" className="line-clamp-2 text-xs text-muted">
                  {status ?? preview(visible) ?? until}
                </p>
              ) : (
                <p className="truncate text-xs text-muted">
                  {view?.connected ? "Connected to your account · " : ""}
                  {until}
                </p>
              )}
            </div>
            {minimised && (
              <button
                type="button"
                ref={restore}
                className="grid size-11 place-items-center rounded-full hover:bg-line/60"
                onClick={() => setAskState("open")}
                aria-controls="ask-panel"
                title="Open the conversation"
              >
                <Icon d={RESTORE} label="Open the conversation" />
              </button>
            )}
            {open && visible.length > 0 && !locked && (
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
            {open && (
              <button
                type="button"
                className="grid size-11 place-items-center rounded-full hover:bg-line/60"
                onClick={() => setWide(!wide)}
                aria-pressed={wide}
                title={wide ? "Leave full screen" : "Full screen"}
              >
                <Icon d={wide ? COLLAPSE : EXPAND} label="Full screen" />
              </button>
            )}
            {open && (
              <button
                type="button"
                className="grid size-11 place-items-center rounded-full hover:bg-line/60"
                onClick={minimise}
                title="Minimise"
              >
                <Icon d={MINIMISE} label="Minimise the assistant" />
              </button>
            )}
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

        {/* Hidden, never unmounted, while minimised: the widget keeps its frame and its state. */}
        <div
          className={
            minimised ? "hidden" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          }
        >
          <div className={`space-y-4 ${inner}`}>
            {visible.length === 0 && (
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
              {visible.map((message, index) => (
                <Bubble
                  key={`${message.role}:${message.at}`}
                  message={message}
                  widget={
                    one?.home === index ? (
                      <>
                        <WidgetFrame
                          uri={one.uri}
                          feed={one.feed}
                          onResult={onResult}
                          onOpen={showPage}
                        />
                        {delivery && (
                          <AskDelivery
                            key={`delivery:${delivery.id}:${delivery.subtotal ?? ""}`}
                            checkoutId={delivery.id}
                            onResult={onResult}
                          />
                        )}
                        {receipt && (
                          <AskReceipt
                            key={receipt}
                            checkoutId={receipt}
                            accountEmail={view?.accountEmail}
                            onResult={onResult}
                            onSignedIn={() => void load(false)}
                          />
                        )}
                      </>
                    ) : undefined
                  }
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

        <footer
          className={`px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${minimised ? "pt-2" : "border-t border-line pt-3"}`}
        >
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
            {canConnect && (
              <div className={minimised ? "hidden" : undefined}>
                <AskConnect onConnected={() => void load(false)} />
              </div>
            )}
            <VoicePanel voice={voice} />
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
                placeholder={calling ? "On a voice call…" : "Ask about a piece…"}
                className="field max-h-40 min-h-11 min-w-0 flex-1 resize-none py-2.5 [field-sizing:content]"
              />
              <MuteButton voice={voice} />
              <VoiceButton voice={voice} />
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

"use client";
// Spec: knowledge/components/ask-agent.md
// Voice in the panel: a round icon beside Send starts it, the password the server checks unlocks
// it, then one call at a time with live captions and a countdown. What the voice hears and answers
// lands in the conversation. The icon shows from the panel's first opening; unlocking starts the
// conversation if none is running. The state lives in the panel, which stays mounted while
// minimised; closing the panel, leaving for a page without it or the session ending hangs up.
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { askCall } from "./askClient";
import { type Caption, clockText, nextCaption, type SessionView } from "./askLogic";
import { startVoiceCall, type VoiceCall } from "./voiceCall";

type Phase = "idle" | "unlocking" | "connecting" | "live";

export function useVoice({
  view,
  shown,
  begin,
  onUnlocked,
}: {
  view: SessionView | undefined;
  // The panel is open or minimised on a page that has it.
  shown: boolean;
  // Starts the conversation the unlock needs; a sentence when the store refused one.
  begin: () => Promise<string | undefined>;
  onUnlocked: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string>();
  const [caption, setCaption] = useState<Caption>();
  const [left, setLeft] = useState<number>();
  const call = useRef<VoiceCall>(undefined);
  const startedAt = useRef<number>(undefined);
  // Ended while still connecting: the call is hung up as soon as it exists.
  const cancelled = useRef(false);

  const end = useCallback(() => {
    cancelled.current = true;
    call.current?.end();
    call.current = undefined;
    setPhase("idle");
  }, []);

  // Unmounting the panel ends the call.
  useEffect(() => () => call.current?.end(), []);

  // So does closing it, a page without the assistant, or voice no longer offered (out of normal
  // mode): its controls are gone, so is the call. The icon shows before the first message too.
  const available = shown && Boolean(view?.voice.available);
  useEffect(() => {
    if (!available) end();
  }, [available, end]);

  // A call belongs to its conversation: one that ended or locked hangs up.
  const inCall = phase === "connecting" || phase === "live";
  const sessionState = view?.state;
  useEffect(() => {
    if (inCall && sessionState !== "active") end();
  }, [inCall, sessionState, end]);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => {
      const max = call.current?.maxSeconds;
      if (max === undefined || startedAt.current === undefined) return;
      setLeft(max - (Date.now() - startedAt.current) / 1000);
    }, 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    // Before the first message there is no conversation yet: unlocking starts one.
    if (view?.state !== "active") {
      const refused = await begin();
      if (refused) return setProblem(refused);
    }
    const answer = await askCall<{ unlocked: boolean }>("/voice/unlock", { password });
    setPassword("");
    if (!answer.data) return setProblem(answer.message);
    setProblem(undefined);
    setPhase("idle");
    onUnlocked();
  };

  const start = async () => {
    setProblem(undefined);
    setCaption(undefined);
    cancelled.current = false;
    setPhase("connecting");
    const started = await startVoiceCall((event) => {
      if (event.kind === "started") {
        startedAt.current = Date.now();
        setPhase("live");
      } else if (event.kind === "caption")
        setCaption((previous) => nextCaption(previous, event.who, event.delta));
      else {
        call.current = undefined;
        startedAt.current = undefined;
        setLeft(undefined);
        setPhase("idle");
      }
    });
    if (started.problem) {
      setProblem(started.problem.message);
      setPhase("idle");
      return;
    }
    if (cancelled.current) {
      started.call?.end();
      return;
    }
    call.current = started.call;
    setLeft(started.call?.maxSeconds);
  };

  return {
    available,
    unlocked: Boolean(view?.voice.unlocked),
    phase,
    calling: inCall,
    password,
    setPassword,
    problem,
    caption,
    left,
    unlock,
    start,
    end,
    // The icon beside Send: start, ask for the password, or hang up.
    press: () => {
      if (phase === "connecting" || phase === "live") return end();
      if (phase === "unlocking") {
        setProblem(undefined);
        return setPhase("idle");
      }
      if (view?.voice.unlocked) return void start();
      setPhase("unlocking");
    },
    cancelUnlock: () => {
      setPhase("idle");
      setProblem(undefined);
    },
  };
}

export type Voice = ReturnType<typeof useVoice>;

// Five bars, as a level meter: they move while the call is live.
const BARS = ["M4 10v4", "M8 7v10", "M12 4v16", "M16 7v10", "M20 10v4"];
function Wave({ live }: { live: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-5 ${live ? "ask-wave" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {BARS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function VoiceButton({ voice }: { voice: Voice }) {
  if (!voice.available) return null;
  const label = voice.calling
    ? "End the voice call"
    : voice.unlocked
      ? "Talk with the assistant"
      : "Voice: unlock with the demo password";
  return (
    <button
      type="button"
      onClick={voice.press}
      aria-pressed={voice.calling}
      aria-expanded={voice.phase === "unlocking"}
      aria-label={label}
      title={label}
      className={`grid size-11 shrink-0 place-items-center rounded-full border transition-colors ${
        voice.calling
          ? "border-ok bg-card text-ok"
          : "border-line bg-card text-ink hover:bg-line/60 aria-expanded:bg-line/60"
      }`}
    >
      <Wave live={voice.phase === "live"} />
    </button>
  );
}

// Above the composer: the password form, the call's bar, or why voice did not start.
export function VoicePanel({ voice }: { voice: Voice }) {
  if (!voice.available) return null;

  if (voice.calling)
    return (
      <section
        aria-label="Voice call"
        className="space-y-2 rounded-2xl border border-line bg-card px-3.5 py-3"
      >
        <div className="flex items-center gap-3">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-ok" />
          </span>
          <p role="status" className="flex-1 text-sm">
            {voice.phase === "connecting" ? "Connecting the voice…" : "Listening"}
            {voice.phase === "live" && voice.left !== undefined && (
              <span className="text-muted tabular-nums"> · {clockText(voice.left)} left</span>
            )}
          </p>
          <button type="button" className="btn-ghost min-h-10 px-4 py-1.5" onClick={voice.end}>
            End
          </button>
        </div>
        {voice.caption && (
          <p className="text-sm text-muted [overflow-wrap:anywhere]" aria-live="polite">
            <span className="font-medium text-ink">
              {voice.caption.who === "you" ? "You" : "Assistant"}:
            </span>{" "}
            {voice.caption.text}
          </p>
        )}
      </section>
    );

  if (voice.phase === "unlocking")
    return (
      <form onSubmit={voice.unlock} className="space-y-1.5">
        <label htmlFor="ask-voice-password" className="text-xs text-muted">
          Voice is reserved for the demo. Enter its password.
        </label>
        <div className="flex gap-2">
          <input
            id="ask-voice-password"
            type="password"
            autoComplete="off"
            className="field min-h-10 flex-1"
            value={voice.password}
            onChange={(e) => voice.setPassword(e.target.value)}
          />
          <button type="submit" className="btn min-h-10 px-4" disabled={!voice.password}>
            Unlock
          </button>
          <button type="button" className="btn-ghost min-h-10 px-3" onClick={voice.cancelUnlock}>
            Cancel
          </button>
        </div>
        {voice.problem && (
          <p role="alert" className="text-sm text-bad">
            {voice.problem}
          </p>
        )}
      </form>
    );

  return voice.problem ? (
    <p role="alert" className="text-sm text-bad">
      {voice.problem}
    </p>
  ) : null;
}

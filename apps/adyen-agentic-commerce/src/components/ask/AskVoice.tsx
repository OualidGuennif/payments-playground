"use client";
// Spec: knowledge/components/ask-agent.md
// Voice in the panel: unlocked with the password the server checks, then one call at a time with
// live captions and a countdown. What the voice hears and answers lands in the conversation.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon, MIC } from "./AskIcon";
import { askCall } from "./askClient";
import { type Caption, clockText, nextCaption, type SessionView } from "./askLogic";
import { startVoiceCall, type VoiceCall } from "./voiceCall";

type Phase = "idle" | "unlocking" | "connecting" | "live";

export function AskVoice({
  view,
  onUnlocked,
  onCalling,
}: {
  view: SessionView;
  onUnlocked: () => void;
  onCalling: (calling: boolean) => void;
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

  useEffect(() => {
    onCalling(phase === "connecting" || phase === "live");
  }, [phase, onCalling]);

  // Closing the panel ends the call.
  useEffect(() => () => call.current?.end(), []);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => {
      const max = call.current?.maxSeconds;
      if (max === undefined || startedAt.current === undefined) return;
      setLeft(max - (Date.now() - startedAt.current) / 1000);
    }, 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  if (!view.voice.available) return null;

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
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

  const end = () => {
    cancelled.current = true;
    call.current?.end();
    call.current = undefined;
    setPhase("idle");
  };

  if (phase === "connecting" || phase === "live")
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
            {phase === "connecting" ? "Connecting the voice…" : "Listening"}
            {phase === "live" && left !== undefined && (
              <span className="text-muted tabular-nums"> · {clockText(left)} left</span>
            )}
          </p>
          <button type="button" className="btn-ghost min-h-10 px-4 py-1.5" onClick={end}>
            End
          </button>
        </div>
        {caption && (
          <p className="text-sm text-muted [overflow-wrap:anywhere]" aria-live="polite">
            <span className="font-medium text-ink">
              {caption.who === "you" ? "You" : "Assistant"}:
            </span>{" "}
            {caption.text}
          </p>
        )}
      </section>
    );

  if (phase === "unlocking")
    return (
      <form onSubmit={unlock} className="space-y-1.5">
        <label htmlFor="ask-voice-password" className="text-xs text-muted">
          Voice is reserved for the demo. Enter its password.
        </label>
        <div className="flex gap-2">
          <input
            id="ask-voice-password"
            type="password"
            autoComplete="off"
            className="field min-h-10 flex-1"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="btn min-h-10 px-4" disabled={!password}>
            Unlock
          </button>
          <button
            type="button"
            className="btn-ghost min-h-10 px-3"
            onClick={() => {
              setPhase("idle");
              setProblem(undefined);
            }}
          >
            Cancel
          </button>
        </div>
        {problem && (
          <p role="alert" className="text-sm text-bad">
            {problem}
          </p>
        )}
      </form>
    );

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="btn-ghost min-h-10 gap-2 px-3.5 py-1.5"
        onClick={() => (view.voice.unlocked ? void start() : setPhase("unlocking"))}
      >
        <Icon d={MIC} />
        {view.voice.unlocked ? "Talk instead" : "Voice"}
      </button>
      {problem && (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      )}
    </div>
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md
"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Actor, Step } from "./content";
import { Rich } from "./Rich";

const COL = 210;
const PAD = 16;
const TOP = 80;
const ROW = 44;

type State = "past" | "now" | "next";

const LINE: Record<State, string> = {
  past: "stroke-ink",
  now: "stroke-accent",
  next: "stroke-line",
};
const HEAD: Record<State, string> = { past: "fill-ink", now: "fill-accent", next: "fill-line" };

// A sequence diagram drawn from the steps, one message at a time: the current one in the accent
// colour, the ones before it in ink, the ones to come faint. The controls and the current step sit
// above the drawing so both stay in view; every step follows as text.
export function SequenceDiagram({
  title,
  actors,
  steps,
}: {
  title: string;
  actors: Actor[];
  steps: Step[];
}) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const last = steps.length - 1;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    if (at >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setAt((n) => Math.min(n + 1, last)), 1800);
    return () => clearTimeout(timer);
  }, [playing, at, last]);

  const x = (id: string) => PAD + COL / 2 + actors.findIndex((a) => a.id === id) * COL;
  const width = PAD * 2 + actors.length * COL;
  const height = TOP + steps.length * ROW;
  const state = (i: number): State => (i < at ? "past" : i === at ? "now" : "next");
  const name = (id: string) => actors.find((a) => a.id === id)?.label ?? id;
  const go = (i: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(i, last)));
  };
  const current = steps[at];

  // On a phone the drawing scrolls sideways: keep the current message in view.
  useEffect(() => {
    const el = scroller.current;
    const step = steps[at];
    if (!el || !step || el.scrollWidth <= el.clientWidth) return;
    const mid = (x(step.from) + x(step.to)) / 2 / width;
    el.scrollTo({ left: mid * el.scrollWidth - el.clientWidth / 2, behavior: "smooth" });
  });

  return (
    <div className="space-y-4">
      <figure className="overflow-hidden rounded-2xl border border-line bg-card">
        <figcaption>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <button
              type="button"
              className="btn-ghost px-4"
              disabled={at === 0}
              onClick={() => go(at - 1)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn px-5"
              disabled={at === last}
              onClick={() => go(at + 1)}
            >
              Next
            </button>
            <button
              type="button"
              className="btn-ghost px-4"
              aria-pressed={playing}
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  if (at === last) setAt(0);
                  setPlaying(true);
                }
              }}
            >
              {playing ? "Pause" : at === last ? "Replay" : "Play"}
            </button>
            <span className="ml-auto text-sm text-muted tabular-nums">
              Step {at + 1} of {steps.length}
            </span>
          </div>
          {current ? (
            <div
              className="space-y-0.5 border-b border-line bg-paper/60 px-4 py-3 text-sm"
              aria-live="polite"
            >
              <p className="text-xs text-muted">
                {name(current.from)} → {name(current.to)}
              </p>
              <p className="font-medium">
                {at + 1}. {current.label}
              </p>
              <p className="text-muted">
                <Rich text={current.text} />
              </p>
            </div>
          ) : null}
        </figcaption>
        <div ref={scroller} className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block w-full min-w-[640px]"
            role="img"
            aria-labelledby={`${uid}-title`}
          >
            <title id={`${uid}-title`}>{title}</title>
            <defs>
              {(["past", "now", "next"] as const).map((s) => (
                <marker
                  key={s}
                  id={`${uid}-${s}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" className={HEAD[s]} />
                </marker>
              ))}
            </defs>
            {actors.map((a) => (
              <g key={a.id}>
                <line
                  x1={x(a.id)}
                  x2={x(a.id)}
                  y1={44}
                  y2={height - 8}
                  strokeDasharray="3 5"
                  className="stroke-line"
                />
                <rect
                  x={x(a.id) - 78}
                  y={10}
                  width={156}
                  height={34}
                  rx={10}
                  className="fill-paper stroke-line"
                />
                <text
                  x={x(a.id)}
                  y={32}
                  textAnchor="middle"
                  className="fill-ink text-[13px] font-medium"
                >
                  {a.label}
                </text>
              </g>
            ))}
            {steps.map((s, i) => {
              const st = state(i);
              const y = TOP + i * ROW;
              const x1 = x(s.from);
              const x2 = x(s.to);
              const dir = x2 > x1 ? 1 : -1;
              return (
                // The state is in the key so the current message's line remounts and draws again.
                <g key={`${s.from}-${s.to}-${s.label}-${st}`}>
                  <line
                    x1={x1 + dir * 11}
                    x2={x2 - dir * 4}
                    y1={y}
                    y2={y}
                    // A drawn line runs 0 to 1; a dashed reply keeps its real length for its dashes.
                    pathLength={s.reply ? undefined : 1}
                    strokeWidth={st === "now" ? 2.5 : 1.5}
                    strokeDasharray={s.reply ? "6 5" : undefined}
                    markerEnd={`url(#${uid}-${st})`}
                    className={`${LINE[st]} ${st === "now" ? (s.reply ? "seq-fade" : "seq-draw") : ""}`}
                  />
                  <text
                    x={(x1 + x2) / 2}
                    y={y - 9}
                    textAnchor="middle"
                    strokeWidth={5}
                    className={`stroke-card text-[12px] [paint-order:stroke] ${
                      st === "next" ? "fill-muted" : "fill-ink"
                    } ${st === "now" ? "font-semibold" : ""}`}
                  >
                    {s.label}
                  </text>
                  <circle
                    cx={x1}
                    cy={y}
                    r={10}
                    className={
                      st === "now"
                        ? "fill-accent"
                        : st === "past"
                          ? "fill-ink"
                          : "fill-card stroke-line"
                    }
                  />
                  <text
                    x={x1}
                    y={y + 4}
                    textAnchor="middle"
                    className={`text-[11px] font-semibold ${st === "next" ? "fill-muted" : "fill-paper"}`}
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </figure>

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={`${s.from}-${s.to}-${s.label}`}>
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === at ? "step" : undefined}
              className={`flex w-full gap-3 rounded-xl border p-3 text-left text-sm transition ${
                i === at
                  ? "border-accent bg-card ring-1 ring-accent"
                  : "border-line hover:border-ink"
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  i === at
                    ? "bg-accent text-paper"
                    : i < at
                      ? "bg-ink text-paper"
                      : "border border-line text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="block text-xs text-muted">
                  {name(s.from)} → {name(s.to)}
                </span>
                <span className="block font-medium break-words">{s.label}</span>
                <span className="block text-muted">
                  <Rich text={s.text} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

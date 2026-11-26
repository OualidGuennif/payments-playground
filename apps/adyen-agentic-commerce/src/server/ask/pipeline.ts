// Spec: knowledge/components/ask-agent.md
// The five stages every shopper message passes, in order (spec invariant 3): deterministic
// security, deterministic context, the LLM guard, the agent, the output filter. A stage that
// refuses stops the message; every verdict, score change, model call and cost is recorded.
import type { Models } from "@earendil-works/pi-ai";
import type { ToolEvent, Widget } from "./agent";
import type { AskLimits } from "./config";
import {
  applyScore,
  CLEAN_BONUS,
  type ContextFailure,
  checkContext,
  type Mode,
  modeFor,
  bagFact,
  pageFact,
} from "./context";
import { gate, type RefusalReason, redactSecrets } from "./gate";
import { runGuard } from "./guard";
import { amountsIn, filterOutput, mergePrices } from "./output";
import { languageOf, refusalText } from "./refusals";
import {
  type AskMessage,
  type AskSession,
  appendMessage,
  endSession,
  mergeCheckouts,
  save,
  sessionById,
  type StageVerdict,
  transcript,
} from "./sessions";

export type PipelineEvent =
  | { type: "stage"; stage: string; result: string }
  | { type: "tool"; name: string; phase: "start" | "end"; label?: string }
  | {
      type: "final";
      text: string;
      widgets: Widget[];
      page?: string;
      mode: Exclude<Mode, "locked">;
      score: number;
      endsAt: number;
    };

// What the agent stage returns; injected so the pipeline is tested without a model.
export type AgentOutcome =
  | {
      ok: true;
      text: string;
      widgets: Widget[];
      prices: number[];
      withheld?: number;
      page?: string;
      calls: number;
      costUsd: number;
      usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
    }
  | {
      ok: false;
      reason: Extract<RefusalReason, "agent_failed" | "model_call_cap">;
      calls: number;
      costUsd: number;
      usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
    };

export type RunAgent = (input: {
  session: AskSession;
  message: string;
  mode: Exclude<Mode, "locked">;
  via: "text" | "voice" | "widget";
  onTool: (event: ToolEvent) => void;
}) => Promise<AgentOutcome>;

export type Admission =
  | { kind: "failed"; failure: ContextFailure }
  | { kind: "busy" }
  | { kind: "refused"; final: Extract<PipelineEvent, { type: "final" }>; events: PipelineEvent[] }
  | {
      kind: "admitted";
      session: AskSession;
      text: string;
      mode: Exclude<Mode, "locked">;
      verdicts: StageVerdict[];
      delta: number;
      signals: string[];
      events: PipelineEvent[];
      shopper: AskMessage;
    };

// One message at a time per session: a second one while the first runs would bill the same
// conversation twice and race its score.
const busy = new Set<string>();
export const isBusy = (sessionId: string) => busy.has(sessionId);

const shownMode = (session: AskSession, mode: Mode): Exclude<Mode, "locked"> =>
  mode === "locked" || session.state !== "active" ? "strict" : mode;

function refusal(
  session: AskSession,
  reason: RefusalReason,
  lang: "fr" | "en",
  mode: Exclude<Mode, "locked">,
): Extract<PipelineEvent, { type: "final" }> {
  return {
    type: "final",
    text: refusalText(reason, lang),
    widgets: [],
    mode,
    score: session.score,
    endsAt: session.endsAt,
  };
}

// Repeated probing is one attack (the defense skill's HEURISTIC-G): a second injection refusal
// in a session locks it, whatever its score.
const ATTACKS = new Set(["gate:injection_signature", "guard:injection"]);
export const attacksSoFar = (sessionId: string) =>
  transcript(sessionId).filter((m) =>
    m.verdicts?.some((v) => ATTACKS.has(`${v.stage}:${v.result}`)),
  ).length;

// Stages 1 and 2: no model, nothing awaited. The route answers a failure as an HTTP error and
// everything else as a stream.
export function admit(input: {
  session: AskSession;
  text: unknown;
  page?: unknown;
  bag?: unknown;
  via: "text" | "voice" | "widget";
  limits: AskLimits;
  regular: boolean;
  address: string;
  storeHost: string;
  now?: number;
  spentToday?: number;
}): Admission {
  const now = input.now ?? Date.now();
  if (busy.has(input.session.id)) return { kind: "busy" };
  const lang = languageOf(typeof input.text === "string" ? input.text : "");
  const events: PipelineEvent[] = [];
  let session = input.session;
  const stage1 = gate(input.text, input.storeHost);
  events.push({ type: "stage", stage: "gate", result: stage1.verdict.result });
  if (!stage1.ok) {
    const repeated = stage1.reason === "injection_signature" && attacksSoFar(session.id) > 0;
    const score = applyScore(session.score, stage1.scoreDelta);
    session = save({ ...session, score, messages: session.messages + 1, lastAt: now });
    // A refused message is kept for the console, but never with card data or a password in it.
    appendMessage(session, {
      role: "shopper",
      text: typeof input.text === "string" ? redactSecrets(input.text).text.slice(0, 200) : "",
      via: input.via,
      verdicts: [stage1.verdict],
      at: now,
    });
    if (repeated) session = endSession(session, "locked", now);
    const mode = shownMode(session, modeFor(session.score, input.regular));
    const final = refusal(session, stage1.reason, lang, mode);
    appendMessage(session, { role: "assistant", text: final.text, at: now });
    events.push(final);
    return { kind: "refused", final, events };
  }
  const stage2 = checkContext({
    session,
    limits: input.limits,
    regular: input.regular,
    address: input.address,
    now,
    spentToday: input.spentToday,
  });
  if (!stage2.ok) {
    if (stage2.failure.kind === "end") endSession(session, stage2.failure.reason, now);
    return { kind: "failed", failure: stage2.failure };
  }
  events.push({ type: "stage", stage: "context", result: stage2.verdict.result });
  busy.add(session.id);
  session = save({ ...session, messages: session.messages + 1, lastAt: now });
  const shopper = appendMessage(session, {
    role: "shopper",
    text: stage1.text,
    via: input.via,
    verdicts: [stage1.verdict, stage2.verdict],
    at: now,
  });
  const page = pageFact(input.page);
  const bag = bagFact(page, input.bag, session.customerId);
  const context = [
    page ? `page: ${page}` : undefined,
    bag ? `bag: ${bag}` : undefined,
    `signed in: ${session.customerId ? "yes" : "no"}`,
    `account connected: ${session.connected ? "yes" : "no"}`,
    // Heard, not typed: a microphone also catches words said to someone else nearby.
    input.via === "voice"
      ? "channel: voice transcript, which may hold words meant for someone nearby; answer only what is asked of you"
      : undefined,
  ]
    .filter(Boolean)
    .join("; ");
  return {
    kind: "admitted",
    session,
    text: `<shop_context>${context}</shop_context>\n<shopper_message>\n${stage1.text}\n</shopper_message>`,
    mode: stage2.mode,
    verdicts: [stage1.verdict, stage2.verdict],
    delta: stage1.scoreDelta,
    signals: stage1.signals,
    events,
    shopper,
  };
}

const lastAnswer = (sessionId: string) =>
  transcript(sessionId)
    .filter((m) => m.role === "assistant")
    .at(-1)?.text;

// Stages 3 to 5, after admission. Always settles the session, releases it and emits one final.
export async function answer(input: {
  admitted: Extract<Admission, { kind: "admitted" }>;
  models: Models;
  runAgent: RunAgent;
  canary: string;
  storeOrigin: string;
  regular: boolean;
  emit: (event: PipelineEvent) => void;
  now?: () => number;
}): Promise<void> {
  const { admitted } = input;
  const clock = input.now ?? Date.now;
  // The gated text, never the raw request: card data stays out of every model's input.
  const shopperText = admitted.shopper.text;
  const lang = languageOf(shopperText);
  const verdicts = [...admitted.verdicts];
  let delta = admitted.delta;
  let costUsd = 0;
  let calls = 0;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  let final: Extract<PipelineEvent, { type: "final" }> | undefined;
  let lock = false;
  const session = () => sessionById(admitted.session.id) ?? admitted.session;
  const finish = (text: string, widgets: Widget[], prices: number[], page?: string) => {
    const current = session();
    const score = applyScore(current.score, delta);
    const settled = save({
      ...current,
      score,
      costUsd: current.costUsd + costUsd,
      prices: mergePrices(current.prices, prices),
      checkouts: mergeCheckouts(
        current.checkouts,
        widgets.map((w) => w.structuredContent),
      ),
      lastAt: clock(),
    });
    const ended = lock ? endSession(settled, "locked", clock()) : settled;
    usage.calls = calls;
    appendMessage(ended, {
      role: "assistant",
      text,
      widgets: widgets.length ? widgets : undefined,
      ...(page ? { page } : {}),
      verdicts,
      usage,
      costUsd,
      at: clock(),
    });
    final = {
      type: "final",
      text,
      widgets,
      ...(page ? { page } : {}),
      mode: shownMode(ended, modeFor(ended.score, input.regular)),
      score: ended.score,
      endsAt: ended.endsAt,
    };
  };
  try {
    const guardChoice = admitted.session.guard;
    const guard = await runGuard({
      models: input.models,
      model: guardChoice.model,
      effort: guardChoice.effort,
      text: shopperText,
      lastAnswer: lastAnswer(admitted.session.id),
      facts: { signals: admitted.signals, refusedBefore: attacksSoFar(admitted.session.id) },
    });
    verdicts.push(guard.verdict);
    costUsd += guard.costUsd;
    calls++;
    if (guard.usage) {
      usage.input += guard.usage.input;
      usage.output += guard.usage.output;
      usage.cacheRead += guard.usage.cacheRead;
      usage.cacheWrite += guard.usage.cacheWrite;
    }
    delta += guard.scoreDelta;
    input.emit({ type: "stage", stage: "guard", result: guard.verdict.result });
    if (!guard.ok) {
      lock = guard.reason === "injection" && attacksSoFar(admitted.session.id) > 0;
      finish(refusalText(guard.reason ?? "guard_unavailable", lang), [], []);
      return;
    }
    const agent = await input.runAgent({
      session: session(),
      message: admitted.text,
      mode: admitted.mode,
      via: admitted.shopper.via ?? "text",
      onTool: (event) => input.emit({ type: "tool", ...event }),
    });
    costUsd += agent.costUsd;
    calls += agent.calls;
    usage.input += agent.usage.input;
    usage.output += agent.usage.output;
    usage.cacheRead += agent.usage.cacheRead;
    usage.cacheWrite += agent.usage.cacheWrite;
    if (!agent.ok) {
      verdicts.push({ stage: "agent", result: agent.reason });
      input.emit({ type: "stage", stage: "agent", result: agent.reason });
      finish(refusalText(agent.reason, lang), [], []);
      return;
    }
    const withheld = agent.withheld ? `; ${agent.withheld} store answer(s) withheld` : "";
    const opened = agent.page ? `; opens ${agent.page}` : "";
    verdicts.push({
      stage: "agent",
      result: "allow",
      detail: `${agent.calls} model call(s)${withheld}${opened}`,
    });
    input.emit({ type: "stage", stage: "agent", result: "allow" });
    // The shopper's own figures are known amounts too: "under €100" may be said back.
    const prices = mergePrices(mergePrices(session().prices, agent.prices), amountsIn(shopperText));
    const out = filterOutput({
      text: agent.text,
      canary: input.canary,
      storeOrigin: input.storeOrigin,
      prices,
    });
    verdicts.push(out.verdict);
    delta += out.scoreDelta;
    input.emit({ type: "stage", stage: "output", result: out.verdict.result });
    if (!out.ok) {
      lock = true;
      finish(refusalText("output_blocked", lang), [], agent.prices);
      return;
    }
    // A clean message, every stage allowed and nothing to deduct, earns a little score back.
    if (delta === 0) delta = CLEAN_BONUS;
    // A page opens only with an answer stage 5 let through (spec invariant 21).
    finish(out.text, agent.widgets, agent.prices, agent.page);
  } catch {
    verdicts.push({ stage: "agent", result: "agent_failed" });
    finish(refusalText("agent_failed", lang), [], []);
  } finally {
    busy.delete(admitted.session.id);
    if (final) input.emit(final);
  }
}

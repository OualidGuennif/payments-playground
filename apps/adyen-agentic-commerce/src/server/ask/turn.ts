// Spec: knowledge/components/ask-agent.md
// One shopper turn through the five stages, shared by typed and voiced messages (spec invariant
// 3): the route and the voice sideband differ only in how they deliver the answer.
import { config } from "../core/config";
import { agentCanary, houseAgentRunner } from "./agent";
import { type Admission, admit, answer, type PipelineEvent } from "./pipeline";
import { askModels } from "./runtime";
import type { AskSession } from "./sessions";
import type { Settings } from "./settings";

export type Turn = { session: AskSession; settings: Settings; regular: boolean; address: string };

// Stages 1 and 2: no model, nothing awaited.
export const admitTurn = (
  turn: Turn,
  text: unknown,
  page: unknown,
  via: "text" | "voice",
  bag?: unknown,
) =>
  admit({
    session: turn.session,
    text,
    page,
    bag,
    via,
    limits: turn.settings.limits,
    regular: turn.regular,
    address: turn.address,
    storeHost: new URL(config().publicOrigin).host,
  });

// Stages 3 to 5 after admission; settles the session and emits one final.
export const answerTurn = (
  admitted: Extract<Admission, { kind: "admitted" }>,
  turn: Turn,
  emit: (event: PipelineEvent) => void,
) =>
  answer({
    admitted,
    models: askModels(),
    runAgent: houseAgentRunner(turn.settings.limits.maxModelCalls),
    canary: agentCanary(),
    storeOrigin: config().publicOrigin,
    regular: turn.regular,
    emit,
  });

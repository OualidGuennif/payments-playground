// Spec: knowledge/components/ask-agent.md
// The console page talks to /api/console only: it imports nothing from the server, so no key,
// password or server module ever reaches the browser bundle.

export type Choice = { model: string; effort: string };
export type Verdict = { stage: string; result: string; detail?: string; scoreDelta?: number };
export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
};

export type Overview = {
  activeSessions: number;
  sessionsToday: number;
  messagesToday: number;
  costTodayUsd: number;
  dailyBudgetUsd: number;
  available: boolean;
  cacheByModel: { model: string; inputTokens: number; cacheReadTokens: number; hitRate: number }[];
  refusals: Record<string, number>;
};

export type SessionSummary = {
  id: string;
  state: "active" | "ended" | "locked";
  endReason?: string;
  createdAt: number;
  lastAt: number;
  endsAt: number;
  customer?: string;
  connected: boolean;
  address: string;
  messages: number;
  costUsd: number;
  score: number;
  answer: Choice;
  guard: Choice;
  agentVersion: string;
  test: boolean;
};

export type Message = {
  id: string;
  seq: number;
  role: "shopper" | "assistant" | "note";
  text: string;
  via?: string;
  widgets?: { resourceUri: string }[];
  verdicts?: Verdict[];
  usage?: Usage;
  costUsd?: number;
  at: number;
};

export type ModelEntry = {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  cost: { input: number; output: number; cacheRead: number };
};

export type Range = { env: string; def: number; min: number; max: number };

export type SettingsView = {
  providers: { id: string; keySet: boolean }[];
  answer?: Choice;
  guard?: Choice;
  voice: { enabled: boolean; model: string };
  limits: Record<string, number>;
  ranges: Record<string, Range>;
  efforts: string[];
  models: ModelEntry[];
  audit: { id: string; at: string; field: string; from: unknown; to: unknown }[];
};

export type StreamEvent =
  | { type: "stage"; stage: string; result: string }
  | { type: "tool"; name: string; phase: "start" | "end"; label?: string }
  | {
      type: "final";
      text: string;
      widgets: { resourceUri: string }[];
      mode: string;
      score: number;
    };

export type PlaygroundResult = {
  sessionId: string;
  refused?: string;
  events: StreamEvent[];
  last?: Message;
};

export type RedTeamResult = {
  sessionId: string;
  results: {
    kind: string;
    text: string;
    expect: string;
    stage: string;
    result: string;
    costUsd: number;
    pass: boolean;
  }[];
};

export type Answer<T> = { status: number; data?: T; error?: string };

// A GET when there is no body, otherwise a POST with the headers the console's routes require.
export async function consoleCall<T>(path: string, body?: unknown): Promise<Answer<T>> {
  const init: RequestInit =
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json", "x-console": "1" },
          body: JSON.stringify(body),
        };
  try {
    const response = await fetch(`/api/console${path}`, init);
    const data = (await response.json().catch(() => undefined)) as
      | (T & { message?: string })
      | undefined;
    return response.ok
      ? { status: response.status, data }
      : { status: response.status, error: data?.message ?? `Error ${response.status}` };
  } catch {
    return { status: 0, error: "The store did not answer." };
  }
}

export const usd = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value)
    ? "unknown"
    : `$${value.toFixed(value < 1 ? 4 : 2)}`;

export const when = (ms: number | undefined) =>
  ms
    ? new Date(ms).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })
    : "unknown";

export const passing = (verdict: Verdict) => ["allow", "normal", "strict"].includes(verdict.result);

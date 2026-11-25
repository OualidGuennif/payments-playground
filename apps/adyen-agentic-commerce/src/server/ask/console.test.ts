// Spec: knowledge/components/ask-agent.md
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { handle } from "../api";
import { freshStore, ORIGIN, randomIp } from "../testing/agent";
import {
  ANSWER_MODEL,
  askSession,
  faux,
  fauxModels,
  GUARD_MODEL,
  startFauxRuntime,
} from "../testing/ask";
import { readAskConfig, resetAskConfig } from "./config";
import { ATTACKS } from "./console";
import { forgetAskLimits } from "./limits";
import { useAskModels } from "./runtime";
import { appendMessage } from "./sessions";

// A test value only: the console's password in this process's test configuration.
const PASSWORD = "console-test-password-0001";
const NO_KEYS = { openai: false, anthropic: false, mistral: false, deepseek: false };
const enable = (password: string | undefined = PASSWORD) =>
  resetAskConfig({
    ...readAskConfig({ CONSOLE_PASSWORD: password }),
    keys: { ...NO_KEYS, openai: true },
    answer: { model: ANSWER_MODEL, effort: "low" },
    guard: { model: GUARD_MODEL, effort: "minimal" },
  });
const verdict = (decision: string) =>
  fauxAssistantMessage(fauxToolCall("verdict", { decision, reason: "test" }), {
    stopReason: "toolUse",
  });

beforeAll(async () => {
  await startFauxRuntime();
  useAskModels(fauxModels);
});
afterAll(() => {
  resetAskConfig();
  useAskModels(undefined);
});
beforeEach(() => {
  freshStore();
  forgetAskLimits();
  faux.setResponses([]);
  enable();
});

class Owner {
  ip = randomIp();
  cookie = "";
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const sent: Record<string, string> = { "x-forwarded-for": this.ip };
    if (method !== "GET") Object.assign(sent, { "x-console": "1", origin: ORIGIN });
    if (this.cookie) sent.cookie = this.cookie;
    if (body !== undefined) sent["content-type"] = "application/json";
    Object.assign(sent, headers);
    const response = await handle(
      new Request(`${ORIGIN}/api/console${path}`, {
        method,
        headers: sent,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0] ?? "";
    return response;
  }
  signIn = (password = PASSWORD) => this.call("POST", "/login", { password });
}

const signedIn = async () => {
  const owner = new Owner();
  expect((await owner.signIn()).status).toBe(200);
  return owner;
};

describe("signing in", () => {
  test("without a password of 16 characters or more the console does not exist", async () => {
    for (const password of ["", "short-password"]) {
      enable(password);
      const owner = new Owner();
      expect((await owner.signIn("anything-at-all-123")).status).toBe(404);
      expect((await owner.call("GET", "/overview")).status).toBe(404);
    }
  });

  test("five wrong passwords, then 429 even for the right one", async () => {
    const owner = new Owner();
    for (let i = 0; i < 5; i++)
      expect((await owner.signIn("wrong-password-0000000")).status).toBe(401);
    expect((await owner.signIn()).status).toBe(429);
  });

  test("the cookie is httpOnly, SameSite=Strict, scoped to the console's API", async () => {
    const owner = new Owner();
    const response = await owner.signIn();
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/console");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  test("every route needs the cookie; every POST the store's origin and X-Console", async () => {
    expect((await new Owner().call("GET", "/overview")).status).toBe(403);
    const owner = await signedIn();
    expect((await owner.call("GET", "/overview")).status).toBe(200);
    const foreign = await owner.call("POST", "/settings", {}, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    const noHeader = await owner.call("POST", "/settings", {}, { "x-console": "" });
    expect(noHeader.status).toBe(403);
    await owner.call("POST", "/logout");
    expect((await owner.call("GET", "/overview")).status).toBe(403);
  });
});

describe("what the console shows", () => {
  test("the overview counts today's sessions, cost and refusals", async () => {
    const { session } = askSession();
    appendMessage(session, {
      role: "assistant",
      text: "ok",
      verdicts: [{ stage: "guard", result: "injection" }],
      usage: { input: 100, output: 10, cacheRead: 300, cacheWrite: 0, calls: 2 },
      costUsd: 0.004,
      at: Date.now(),
    });
    const owner = await signedIn();
    const view = (await (await owner.call("GET", "/overview")).json()) as Record<string, any>;
    expect(view.activeSessions).toBe(1);
    expect(view.costTodayUsd).toBeCloseTo(0.004);
    expect(view.refusals).toEqual({ guard: 1 });
    expect(view.cacheByModel).toEqual([
      { model: ANSWER_MODEL, inputTokens: 400, cacheReadTokens: 300, hitRate: 0.75 },
    ]);
  });

  test("sessions with their full transcript; the console may end or lock one", async () => {
    const { session } = askSession();
    appendMessage(session, { role: "shopper", text: "hello", verdicts: [], at: Date.now() });
    const owner = await signedIn();
    const list = (await (await owner.call("GET", "/sessions?state=active")).json()) as {
      sessions: { id: string; score: number }[];
    };
    expect(list.sessions.map((s) => s.id)).toEqual([session.id]);
    const detail = (await (await owner.call("GET", `/sessions/${session.id}`)).json()) as {
      messages: { text: string }[];
    };
    expect(detail.messages.map((m) => m.text)).toEqual(["hello"]);
    const locked = (await (await owner.call("POST", `/sessions/${session.id}/lock`)).json()) as {
      state: string;
    };
    expect(locked.state).toBe("locked");
  });

  test("a settings change is audited; a bad one is refused and changes nothing", async () => {
    const owner = await signedIn();
    const before = (await (await owner.call("GET", "/settings")).json()) as Record<string, any>;
    expect(before.models.map((m: { id: string }) => m.id)).toContain(ANSWER_MODEL);
    expect(JSON.stringify(before)).not.toContain(PASSWORD);
    const bad = await owner.call("POST", "/settings", {
      answer: { model: "anthropic/x", effort: "low" },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_setting");
    const saved = (await (
      await owner.call("POST", "/settings", { voiceEnabled: false, limits: { maxMessages: 20 } })
    ).json()) as Record<string, any>;
    expect(saved.voice.enabled).toBe(false);
    expect(saved.limits.maxMessages).toBe(20);
    expect(saved.audit.map((a: { field: string }) => a.field).sort()).toEqual([
      "limits.maxMessages",
      "voiceEnabled",
    ]);
  });
});

describe("testing the agents", () => {
  test("the playground runs the five stages on a test session and shows every verdict", async () => {
    faux.setResponses([verdict("allow"), fauxAssistantMessage(fauxText("Hello from the shop."))]);
    const owner = await signedIn();
    const result = (await (
      await owner.call("POST", "/playground", { text: "Hello, what do you sell?" })
    ).json()) as Record<string, any>;
    const stages = result.events.filter((e: { type: string }) => e.type === "stage");
    expect(stages.map((e: { stage: string }) => e.stage)).toEqual([
      "gate",
      "context",
      "guard",
      "agent",
      "output",
    ]);
    expect(stages[2].result).toBe("allow");
    expect(result.events.at(-1).text).toBe("Hello from the shop.");
    expect(result.last.verdicts).toHaveLength(5);
    const sessions = (await (await owner.call("GET", "/sessions")).json()) as {
      sessions: { id: string; test: boolean }[];
    };
    expect(sessions.sessions.find((s) => s.id === result.sessionId)?.test).toBe(true);
  });

  test("the red-team list: stage 1 refuses its cases without a model; the guard gets the rest", async () => {
    const guardCases = ATTACKS.filter((a) => a.expect === "guard").length;
    faux.setResponses(Array.from({ length: guardCases }, () => verdict("injection")));
    const before = faux.state.callCount;
    const owner = await signedIn();
    const run = (await (await owner.call("POST", "/redteam")).json()) as {
      results: { kind: string; expect: string; stage: string; pass: boolean }[];
    };
    expect(faux.state.callCount - before).toBe(guardCases);
    for (const r of run.results) {
      expect(r.stage).toBe(r.expect);
      expect(r.pass).toBe(true);
    }
  });
});

describe("keys stay server-side", () => {
  test("no browser module imports the Ask server code", async () => {
    const offenders: string[] = [];
    for await (const path of new Bun.Glob("src/**/*.{ts,tsx}").scan(".")) {
      const text = await Bun.file(path).text();
      const browser =
        /^\s*["']use client["']/.test(text) ||
        path.startsWith("src/components/console/") ||
        path.startsWith("src/components/ask/");
      if (browser && /from\s+["'](@\/server\/ask|[./]+\/server\/ask|[./]+\/ask\/)/.test(text))
        offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

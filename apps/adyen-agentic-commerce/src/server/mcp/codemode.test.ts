// Spec: knowledge/components/code-mode.md
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handle } from "../api";
import { freshStore, ORIGIN, randomIp, TestAgent } from "../testing/agent";
import { type CallTool, LIMITS, runCode, TRUNCATED } from "./codemode";

const asked: { name: string; args: Record<string, unknown> }[] = [];
const echo: CallTool = async (name, args) => {
  asked.push({ name, args });
  return { ok: true, value: { tool: name, args } };
};

describe("Code Mode sandbox", () => {
  test("search reads the tool list and calls nothing", async () => {
    asked.length = 0;
    const run = await runCode(
      "search",
      `async () => (await codemode.tools()).filter((t) => t.name.endsWith("_checkout")).map((t) => t.name)`,
      echo,
    );
    expect(run.ok).toBe(true);
    if (run.ok) expect(JSON.parse(run.result)).toContain("create_checkout");
    expect(asked).toEqual([]);
    const tried = await runCode("search", `async () => codemode.get_cart({ id: "x" })`, echo);
    expect(tried.ok).toBe(false);
    expect(asked).toEqual([]);
  });

  test("execute calls store tools and returns only the value", async () => {
    asked.length = 0;
    const run = await runCode(
      "execute",
      `async () => {
        const a = await codemode.get_cart({ id: "c1" });
        const b = await codemode.get_order({ id: "o1" });
        console.log("two calls", { n: 2 });
        return [a.tool, b.args.id];
      }`,
      echo,
    );
    expect(run).toMatchObject({
      ok: true,
      result: '["get_cart","o1"]',
      logs: ['two calls {"n":2}'],
    });
    expect(run.calls).toEqual([
      { tool: "get_cart", ok: true },
      { tool: "get_order", ok: true },
    ]);
  });

  test("token never in the sandbox: no host function, network, timers or modules", async () => {
    const run = await runCode(
      "execute",
      `async () => ({
        host: typeof __host, log: typeof __log, fetch: typeof fetch, xhr: typeof XMLHttpRequest,
        timer: typeof setTimeout, require: typeof require, process: typeof process,
        std: typeof std, os: typeof os, frozen: Object.isFrozen(codemode),
        keys: Object.keys(globalThis).filter((k) => !["codemode", "console"].includes(k)),
      })`,
      echo,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const seen = JSON.parse(run.result);
    for (const key of ["host", "log", "fetch", "xhr", "timer", "require", "process", "std", "os"])
      expect(seen[key]).toBe("undefined");
    expect(seen.frozen).toBe(true);
    expect(seen.keys).toEqual([]);
    const imported = await runCode("execute", `async () => (await import("os")).exec`, echo);
    expect(imported.ok).toBe(false);
  });

  test("complete_checkout refused: the host never forwards a payment", async () => {
    asked.length = 0;
    const run = await runCode(
      "execute",
      `async () => codemode.complete_checkout({ id: "chk_1", checkout: {} })`,
      echo,
    );
    expect(run).toMatchObject({ ok: false, code: "tool_refused" });
    expect(asked).toEqual([]);
    const caught = await runCode(
      "execute",
      `async () => { try { await codemode.complete_checkout({ id: "chk_1", checkout: {} }); } catch (e) { return e.message; } }`,
      echo,
    );
    expect(caught.ok && JSON.parse(caught.result)).toStartWith("tool_refused:");
  });

  test("a refusal reaches the code as an Error with the store's code", async () => {
    const refusing: CallTool = async () => ({
      ok: false,
      code: "insufficient_scope",
      message: "This needs ucp:checkout",
    });
    const run = await runCode(
      "execute",
      `async () => { try { await codemode.create_checkout({ checkout: {} }); } catch (e) { return e.message; } }`,
      refusing,
    );
    expect(run.ok && JSON.parse(run.result)).toBe("insufficient_scope: This needs ucp:checkout");
    expect(run.calls).toEqual([{ tool: "create_checkout", ok: false }]);
  });

  test("infinite loop stops", async () => {
    const started = Date.now();
    const run = await runCode("execute", "async () => { while (true) {} }", echo);
    expect(run).toMatchObject({ ok: false, code: "timeout" });
    expect(Date.now() - started).toBeLessThan(LIMITS.cpuMs + 2_000);
  });

  test("memory bomb stops", async () => {
    const run = await runCode(
      "execute",
      "async () => { const a = []; while (true) a.push(new Array(1e5).fill(1)); }",
      echo,
    );
    expect(run).toMatchObject({ ok: false, code: "memory_limit" });
    // The next run gets a fresh interpreter.
    expect((await runCode("execute", "async () => 1 + 1", echo)).ok).toBe(true);
  });

  test("call cap", async () => {
    asked.length = 0;
    const run = await runCode(
      "execute",
      `async () => { for (let i = 0; i < 25; i++) await codemode.get_cart({ id: "c" + i }); }`,
      echo,
    );
    expect(run).toMatchObject({ ok: false, code: "too_many_calls" });
    expect(asked).toHaveLength(LIMITS.calls);
    // Calls started together count as they start, not as they settle.
    asked.length = 0;
    const together = await runCode(
      "execute",
      `async () => Promise.all(Array.from({ length: 60 }, (_, i) => codemode.get_cart({ id: "c" + i })))`,
      echo,
    );
    expect(together).toMatchObject({ ok: false, code: "too_many_calls" });
    expect(asked).toHaveLength(LIMITS.calls);
  });

  test("a host-side failure answering the code ends the run at once", async () => {
    // A value the host cannot encode for QuickJS: the error is raised while answering the code.
    const unencodable: CallTool = async () => ({
      ok: true,
      value: {
        toJSON() {
          throw new Error("cannot encode");
        },
      },
    });
    const started = Date.now();
    const run = await runCode(
      "execute",
      `async () => (await codemode.get_cart({ id: "c" })).length`,
      unencodable,
    );
    expect(run).toMatchObject({ ok: false, code: "code_error", message: "cannot encode" });
    expect(Date.now() - started).toBeLessThan(LIMITS.wallMs);
  });

  test("truncated", async () => {
    const run = await runCode("execute", `async () => "x".repeat(30000)`, echo);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.truncated).toBe(true);
    expect(run.result.endsWith(TRUNCATED)).toBe(true);
    expect(run.result.length).toBe(LIMITS.resultChars + TRUNCATED.length);
  });

  test("bad code is refused before or while it runs", async () => {
    expect(await runCode("execute", "", echo)).toMatchObject({ code: "invalid_code" });
    expect(await runCode("execute", 42, echo)).toMatchObject({ code: "invalid_code" });
    const long = `async () => "${"x".repeat(LIMITS.codeChars)}"`;
    expect(await runCode("execute", long, echo)).toMatchObject({ code: "invalid_code" });
    expect(await runCode("execute", "async () => {", echo)).toMatchObject({ code: "code_error" });
    expect(await runCode("execute", "42", echo)).toMatchObject({ code: "code_error" });
  });
});

describe("POST /mcp/code", () => {
  let agent: TestAgent;
  beforeAll(async () => {
    freshStore();
    agent = await TestAgent.start("Code Mode agent");
    agent.ip = randomIp();
    await agent.signIn();
  });
  afterAll(() => agent.stop());

  const rpc = async (method: string, params: Record<string, unknown>, token?: string) => {
    const response = await handle(
      new Request(`${ORIGIN}/mcp/code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": agent.ip,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    return { status: response.status, headers: response.headers, body: await response.json() };
  };

  test("asks an unknown caller to sign in for this resource", async () => {
    const answer = await rpc("tools/list", {});
    expect(answer.status).toBe(401);
    expect(answer.headers.get("www-authenticate")).toContain(
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp/code`,
    );
    const meta = await handle(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp/code`),
    );
    expect(((await meta.json()) as { resource: string }).resource).toBe(`${ORIGIN}/mcp/code`);
  });

  test("lists two tools, search and execute", async () => {
    const answer = await rpc("tools/list", {}, agent.accessToken);
    const tools = answer.body.result.tools as { name: string; description: string }[];
    expect(tools.map((t) => t.name)).toEqual(["search", "execute"]);
    expect(tools[1]?.description).toContain("declare const codemode");
  });

  test("same identity: the code's cart is the agent's own cart on /mcp", async () => {
    const answer = await rpc(
      "tools/call",
      {
        name: "execute",
        arguments: {
          code: `async () => {
            const { products = [] } = await codemode.search_catalog({ catalog: { query: "shirt" } });
            const variant = products.flatMap((p) => p.variants ?? []).find((v) => v.availability?.available);
            const cart = await codemode.create_cart({ cart: { line_items: [{ item: { id: variant.id }, quantity: 1 }] } });
            return { cart: cart.id, lines: cart.line_items.length };
          }`,
        },
      },
      agent.accessToken,
    );
    expect(answer.status).toBe(200);
    const result = answer.body.result;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.calls).toEqual([
      { tool: "search_catalog", ok: true },
      { tool: "create_cart", ok: true },
    ]);
    const { cart, lines } = result.structuredContent.result;
    expect(lines).toBe(1);
    const read = await agent.tool("get_cart", { id: cart });
    expect(read.content.id).toBe(cart);
    // Another agent's identity cannot read it: the cart belongs to this client and account.
    const other = await TestAgent.start("Other agent");
    other.ip = randomIp();
    await other.signIn();
    const theirs = await rpc(
      "tools/call",
      { name: "execute", arguments: { code: `async () => codemode.get_cart({ id: "${cart}" })` } },
      other.accessToken,
    );
    expect(theirs.body.result.isError).toBe(true);
    other.stop();
  });

  test("runs per address", async () => {
    agent.ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const answer = await rpc(
        "tools/call",
        { name: "execute", arguments: { code: "async () => 1" } },
        agent.accessToken,
      );
      statuses.push(answer.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  test("an invalid token is refused before any code runs", async () => {
    const answer = await rpc(
      "tools/call",
      { name: "execute", arguments: { code: "async () => 1" } },
      "not-a-token",
    );
    expect(answer.status).toBe(401);
  });
});

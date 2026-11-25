---
type: Component
title: "Code Mode: the agentic store's MCP tools as code an agent writes, run in a WASM sandbox"
description: "A second MCP endpoint, /mcp/code, with two tools (search and execute): the agent writes a short JavaScript function that calls the store's own MCP tools, the store runs it in a QuickJS sandbox and returns only the result."
tags: [component, agentic, mcp, code-mode, sandbox, quickjs, security]
status: draft
scope: component-code-mode
generated:
  by: claude-code/opus-5.5
  at: 2026-11-25T22:50:00Z
sources:
  - id: store
    resource: ./adyen-agentic-commerce.md
    title: "The store's spec: the 13 MCP tools, grants, scopes, budgets and limits Code Mode calls"
  - id: cf-guide
    resource: https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/
    title: "Cloudflare: build a Code Mode MCP server (code tool; search and execute; sandbox boundary)"
  - id: cf-blog
    resource: https://blog.cloudflare.com/code-mode-mcp/
    title: "Cloudflare: Code Mode, give agents an entire API in 1,000 tokens"
  - id: quickjs
    resource: https://github.com/justjake/quickjs-emscripten
    title: "quickjs-emscripten 0.32.0: QuickJS compiled to WebAssembly, memory, stack and interrupt limits"
  - id: code
    resource: ../../apps/adyen-agentic-commerce/src/server/mcp/codemode.ts
    title: "The sandbox, the two tools and their limits"
  - id: tests
    resource: ../../apps/adyen-agentic-commerce/src/server/mcp/codemode.test.ts
    title: "The sandbox's escape, limit and identity tests"
  - id: route
    resource: ../../apps/adyen-agentic-commerce/src/app/mcp/code/route.ts
    title: "The Next.js route that hands /mcp/code to the store's server"
---

# Code Mode

## Intent

Owner request 2026-11-25: put Cloudflare's "Code Mode" on top of the store's MCP connection and
explain it well. An agent normally calls one tool, reads the whole answer, then calls the next:
each step costs a round trip and fills its context with data it does not need. With Code Mode the
agent writes one small JavaScript function that calls the store's tools itself (search the
catalogue, pick the cheapest size in stock, put it in a cart), and only the function's return value
comes back. The store runs that code in a sandbox it controls.

It is a second door, not a new power. Every call the code makes goes through the store's ordinary
MCP handler with the caller's own token or PAP Session, so scopes, budgets, rate limits, traces and
refusals are exactly those of `/mcp`. The model proposes code; deterministic code decides what runs.

## Data sources

| Source | What is read | Owner | Freshness |
| --- | --- | --- | --- |
| The store's MCP tool list (`MCP_TOOLS`) | Names, descriptions, input schemas | App | Build |
| The store's MCP handler (in-process, `serveMcp`) | Every tool call's result or refusal | App | Per call |
| QuickJS WASM (`quickjs-emscripten` 0.32.0, release sync build) | The interpreter the code runs in | Package | Version pin |

## Inputs

- `POST /mcp/code`: MCP over streamable HTTP with JSON answers, protocol versions as `/mcp`
  (`initialize`, `tools/list`, `tools/call`, `ping`; notifications get 202). Authentication as
  `/mcp`: a bearer token whose resources include `${PUBLIC_ORIGIN}/mcp/code` (or name none), or a
  verified PAP Session for a signed-out PAP agent; otherwise 401 with `WWW-Authenticate` naming
  `/.well-known/oauth-protected-resource/mcp/code`. The OAuth server serves this third resource.
- `search` `{ code: string }`: an async arrow function, at most 20,000 characters. Inside it,
  `codemode.tools()` returns the store's tools (`name`, `description`, `inputSchema`,
  `annotations`).
- `execute` `{ code: string }`: the same shape. Inside it, `codemode.<tool>(args)` calls that store
  tool and resolves to its `structuredContent` (else its text, parsed as JSON when it is JSON); a
  refused call throws an `Error` whose message is the store's code and sentence. `console.log`
  lines are kept (at most 50, 500 characters each).

## Outputs

- `tools/list`: `search` and `execute`, each description carrying the TypeScript declaration of
  the `codemode` object (one line per tool) and an example.
- A `tools/call` answer: `content` (one text block, the JSON of the return value) and
  `structuredContent` `{ result, calls: [{ tool, ok }], logs }`. A failure is a tool result with
  `isError: true` and one sentence: `code_error` (the code threw or did not parse),
  `timeout` (over 0.5 s of interpreter time or 10 s in all), `memory_limit` (over 32 MB),
  `busy` (all runs together used 10 s of interpreter time in the last minute),
  `too_many_calls` (over 20 store calls), `tool_refused` (`complete_checkout`, below),
  `invalid_code` (not a string, empty or too long), with the calls made before it.
- A return value longer than 24,000 characters (about 6,000 tokens, Cloudflare's limit) is cut
  and ends with `--- TRUNCATED ---`.
- Trace: one Back Office line per run (channel `mcp`, path `/mcp/code`, tool `search` or
  `execute`, the tools called), and each store call keeps its own line as on `/mcp`.

## Invariants

1. **No new authority.** The code reaches the store only through `codemode.<tool>`, which calls the
   in-process MCP handler with the outer request's identity; the token never enters the sandbox,
   and a scope, budget or limit refusal there is the same refusal here. Test:
   `src/server/mcp/codemode.test.ts` "same identity", "token never in the sandbox".
2. **Paying is never code.** `complete_checkout` is not in the sandbox: a payment, or a hand-over
   to the shopper, stays one deliberate call on `/mcp` that hosts show as destructive and may ask
   the shopper about. Test: "complete_checkout refused".
3. **The sandbox has nothing else.** No network, file system, timers, `eval` of host code, `require`
   or `import`; the interpreter gets 32 MB, a 512 KB stack, 0.5 s of its own time and 10 s in
   all, and at most 20 store calls, counted as each one starts so calls started together
   (`Promise.all`) meet the same cap. A run that breaks a limit stops and is disposed; an error
   on the host side while answering the code ends the run at once. QuickJS runs
   on the server's main thread, so one address gets 10 runs a minute (429 `rate_limited`) and all
   runs together 10 s of interpreter time a minute (`busy`): a hostile loop can hold the store
   for half a second, never longer. Test: "token never in the sandbox", "infinite loop stops",
   "memory bomb stops", "call cap", "a host-side failure answering the code ends the run at
   once", "runs per address".
4. **Bounded answer.** The answer never exceeds 24,000 characters of result plus the call list and
   50 log lines. Test: "truncated".

## Determinism

Deterministic: the sandbox, its limits and the dispatch to store tools. The code itself is the
agent's, untrusted, and judged only by what the store's tools accept.

## Acceptance checks

- `bun test src/server/mcp/codemode.test.ts`; the store's `bun test` and `next build`.
- Locally: `tools/list` on `/mcp/code` shows two tools; an `execute` that searches the catalogue
  and creates a cart returns one small object, and the Back Office shows one `/mcp/code` line plus
  the store calls.

## Out of scope

- Paying from code; a code tool per upstream server (`codeMcpServer`'s single `code` tool):
  `search` keeps the catalogue of tools out of the agent's context until it asks.
- Persisting code or results; sharing state between runs; npm modules inside the sandbox.

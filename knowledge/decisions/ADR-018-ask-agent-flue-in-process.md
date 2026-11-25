---
type: Decision
title: "ADR-018: Ask agent, a Flue agent in the store's process that shops through the store's own MCP"
description: "Owner, 2026-11-25: the agentic store's chat runs Flue 2.3.1 in-process on Bun with Pi's OpenAI, Anthropic, Mistral and DeepSeek providers, no LiteLLM, the store's MCP as its only tools, a password console and GPT-Live voice."
tags: [decision, agentic, ask, flue, llm, security, voice]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-25T18:00:00Z
sources:
  - id: spec
    resource: ../components/ask-agent.md
    title: The Ask agent's spec
  - id: store
    resource: ../components/adyen-agentic-commerce.md
    title: The store's spec (MCP tools, grants, device sign-in, widgets)
  - id: flue-why
    resource: https://flueframework.com/docs/guide/why-flue/
    title: "Flue: why Flue (agents as functions, tools exist only when mounted)"
  - id: flue-tools
    resource: https://flueframework.com/docs/guide/tools/
    title: "Flue: tools (timeoutMs, MCP allowlist)"
  - id: flue-durability
    resource: https://flueframework.com/docs/guide/durability/
    title: "Flue: durability (maxAttempts, timeoutMs, transient retries)"
  - id: openai-cache
    resource: https://developers.openai.com/api/docs/guides/prompt-caching
    title: "OpenAI: prompt caching (prompt_cache_key, 1,024-token prefix)"
  - id: mistral-cache
    resource: https://docs.mistral.ai/studio/conversations/advanced/prompt-caching
    title: "Mistral: prompt caching"
  - id: deepseek-cache
    resource: https://api-docs.deepseek.com/guides/kv_cache
    title: "DeepSeek: context caching on disk"
  - id: gpt-live
    resource: https://developers.openai.com/api/docs/guides/live
    title: "OpenAI: GPT-Live sessions over WebRTC"
  - id: gpt-live-delegation
    resource: https://developers.openai.com/api/docs/guides/live-delegation
    title: "OpenAI: GPT-Live client delegation and the sideband"
---

# ADR-018: Ask agent, Flue in the store's process, shopping through the store's own MCP

**Status.** Accepted by the owner on 2026-11-25, in chat, after three rounds of planning ("Oui go"),
including the install of `@flue/runtime` 2.3.1 and its dependencies.

## Context

The owner wants a chat on the agentic store for guests and signed-in shoppers: pretty, in the
site's design, with the store's own product widgets; a Flue agent "using PAP at full power" with
deterministic limits; keys on the server only (nobody pastes a key, shoppers pick neither model
nor effort); four providers (OpenAI recommended, Anthropic, Mistral, DeepSeek) with good prompt
caching; a password console to pick models, test agents and read every session; three checks
before each answer and a security score per session, slightly relaxed for regulars; a time limit
per session; and an OpenAI voice mode behind a switch and the password `adyentic`.

Research on 2026-11-25 (Flue's guides and source, Pi's provider code, the providers' cache pages,
OpenAI's GPT-Live pages) and a spike under Bun 1.4.4 found:

- Flue has no prompt-injection defence, no approval API and no security layer. What it does give:
  a tool exists only when mounted; with no sandbox there is no file or shell tool; `timeoutMs` per
  tool; `durability`; an MCP tool allowlist with a per-request credential and a custom `fetch`.
- A mounted Flue agent route has no authentication; anyone with the URL could read a history.
- Flue starts in-process (`start()` from `@flue/runtime/node`, 3 ms) on Bun with `node:sqlite`.
  A plain message is one model call, a tool message two. Flue retries a transient provider error
  three times (a 500 became 4 requests). It always mounts a `task` tool, which spawns nothing
  without a declared subagent.
- Pi already writes the cache fields: OpenAI `prompt_cache_key` (one per conversation) with
  instructions as developer messages, Anthropic `cache_control` on the system block, Mistral
  `prompt_cache_key`; DeepSeek caches automatically. Pi's key lookup reads `process.env`.
- LiteLLM's PyPI releases 1.82.7 and 1.82.8 were credential stealers; Pi covers the four providers
  without it.
- GPT-Live 1.1 (`gpt-live-1.1`, the newest; there is no "1.2") runs over WebRTC from the browser,
  with the session created by the server and a server sideband for client delegation.

## Decision

1. **Flue in the store's process,** started once per process, with its own SQLite file next to
   the store's database. No Flue HTTP route is mounted; the store's Elysia API is the only door, and
   it addresses Flue instances by server-issued session ids.
2. **Pi's built-in providers** `openai`, `anthropic`, `mistral`, `deepseek`, registered only when
   their key is set. No LiteLLM, no OpenCode Go, no key from a shopper. Defaults come from `ASK_*`
   variables; the console overrides them and audits each change.
3. **The store's own MCP server is the agent's only tool source,** reached in-process through
   `app.handle` with Flue's custom `fetch`, with no token for a guest and the shopper's own grant
   token once they connect the house client through device sign-in and consent. The house agent is
   one registered public client of the store, "Atelier Velune Ask": it can do nothing an outside
   agent with the same grant could not, and the Back Office shows its calls like any agent's.
4. **Five stages per message:** deterministic security, deterministic context, an LLM guard with
   one forced verdict, the agent, a deterministic output filter. The score, thresholds and their
   regular-shopper relaxation are fixed in code and tested; the relaxation never touches stage 1,
   hard limits, payment rules or step-up.
5. **Cost and cache:** every model call, retries included, is metered from Flue's `turn` events
   and the guard's usage, against a per-message call cap and per-session and per-day budgets in
   USD. The system prompt and tool order are frozen per agent version, model and effort are fixed
   per session, compaction is off, facts are appended as messages.
6. **Console `/console`:** a password from `CONSOLE_PASSWORD` (at least 16 characters, else the
   console does not exist), its own cookie, a per-address limit and an origin check. It is separate
   from the Back Office's Basic auth.
7. **Voice through GPT-Live 1.1:** WebRTC from the browser, the session created and the sideband
   held by the server, client delegation, so every voiced request runs the same five stages and the
   same Flue conversation. The Showcase relay (a WebSocket server with AudioWorklets) stays the
   fallback should WebRTC fail on Firefox, since Next's standalone server has no WebSocket upgrade.

## Consequences

- `@flue/runtime` 2.3.1 brings Pi with every provider's SDK (about 110 packages, AWS and Google
  among them); two install scripts are blocked. Flue declares Node ≥ 22.19 and runs here on Bun;
  a Flue upgrade is checked against the spike's cases (`ask/runtime.test.ts`).
- The password `adyentic` is in the repository: it is a sales gate, not protection. Protection is
  the minutes caps, the per-address limits and the daily budget.
- One Flue `turn` per model call means a provider outage costs up to four calls per message; the
  call cap counts them.
- A provider's per-conversation cache key means the first message of each session pays the shared
  prefix once; later messages hit the cache.

## Revisit when

- Flue gains authentication on mounted routes, an approval API or a built-in guard.
- OpenAI ships a GPT-Live version with a different delegation contract, or Firefox WebRTC audio
  fails in tests.
- A provider changes its cache fields and Pi does not follow.

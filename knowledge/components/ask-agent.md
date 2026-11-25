---
type: Component
title: "Ask agent: the agentic store's own chat, a Flue agent behind a five-stage gate"
description: "The agentic store's chat for guests and shoppers: a Flue agent shopping over the store's own MCP like any PAP client, server-only keys, a five-stage gate, a score per session, a password console, OpenAI voice."
tags: [component, agentic, ask, flue, llm, security, console, voice]
status: draft
scope: component-ask-agent
generated:
  by: claude-code/opus-5.5
  at: 2026-11-25T23:00:00Z
sources:
  - id: adr
    resource: ../decisions/ADR-018-ask-agent-flue-in-process.md
    title: "ADR-018: why Flue in-process, Pi's providers, the store's own MCP and GPT-Live"
  - id: store
    resource: ./adyen-agentic-commerce.md
    title: "The store's spec: MCP tools, grants, budgets, consent, device sign-in, widgets"
  - id: app
    resource: ../../apps/adyen-agentic-commerce
    title: "The app; this feature lives in src/server/ask, src/components/ask and src/app/console"
  - id: flue
    resource: https://flueframework.com/docs/guide/tools/
    title: "Flue 2.3: tools, MCP connections (allowlist, auth resolver, custom fetch)"
  - id: gpt-live
    resource: https://developers.openai.com/api/docs/guides/live-delegation
    title: "OpenAI GPT-Live: client delegation and the server sideband"
---

# Ask agent

## Intent

Owner decision 2026-11-25 ([ADR-018](../decisions/ADR-018-ask-agent-flue-in-process.md)): the
agentic store gets its own assistant, "Ask agent", in a right sidebar (full screen on demand, a
sheet on phones), for guests and signed-in shoppers. It runs a Flue agent in the store's process,
and that agent shops **through the store's own MCP server** with the same tools, scopes, budgets
and consent as ChatGPT or any PAP agent: it holds no privilege of its own. A signed-in shopper may
connect it to their account through the standard device sign-in and consent screen, after which it
may pay with a saved card within the budget they set. Model keys stay on the server; shoppers never
choose a model or an effort. Every message passes five stages: deterministic security,
deterministic context, an LLM guard, the agent, a deterministic output filter. A password-protected
`/console` lets the owner pick models, watch sessions and test the agents. On OpenAI conversations a
voice mode (GPT-Live) talks to the same agent through the same gate.

## Data sources

| Source                                   | What is read                                                    | Owner  | Freshness          |
| ---------------------------------------- | --------------------------------------------------------------- | ------ | ------------------ |
| `.env` / Render variables (never read by tooling) | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `CONSOLE_PASSWORD`, `ASK_*` defaults (`.env.example`) | Owner | Boot |
| SQLite (`DATABASE_PATH`)                 | Ask sessions, messages with stage verdicts and costs, console settings and audit log, console sessions, the house client's id | App | Per request |
| Flue's SQLite (`dirname(DATABASE_PATH)/flue.sqlite`) | Flue's own conversation records, one instance per Ask session | Flue | Per submission |
| The store's MCP handler (in-process `handleHouseMcp`, no route) | UCP catalogue, cart, checkout and order tools; widget resources | App | Per tool call |
| Pi's model catalogue (`@earendil-works/pi-ai`) | Model ids, reasoning support, per-million-token prices (USD) | Pi | Package version |
| Model providers (HTTPS)                  | Answers, tool calls, usage (input, output, cache read, cache write) | Provider | Per call |
| OpenAI GPT-Live (`/v1/live/sessions`, sideband WebSocket) | Voice session, transcripts, delegation events | OpenAI | Per call |

## Inputs

- **Shopper message** `POST /api/ask/messages` `{ text: string ≤ 1,000 chars after NFKC, page?:
  store path }`, with the `av_ask` cookie (httpOnly, `SameSite=Lax`, `Secure` on https, path
  `/api/ask`) naming the session. The customer comes from the store's own session cookie, never
  from the body.
- **Session** `GET /api/ask/session` (read, creates nothing); `POST /api/ask/session` (start a new
  one, ending the current); `POST /api/ask/session/end`.
- **Connect** `POST /api/ask/connect` (signed in only) starts a device sign-in for the house
  client and returns the store's `/device` URL with the user code filled in; `GET /api/ask/connect`
  polls it. Tokens never leave the server.
- **Widget action** `POST /api/ask/widget` `{ name, arguments }` from a widget in the panel: a
  shopper's tap, forwarded to `/mcp` as the session's identity, allowlist below; a widget's
  `ui/message` is sent as an ordinary shopper message.
- **Voice** `POST /api/ask/voice/unlock` `{ password }`; `POST /api/ask/voice/call` `{ sdp }` (an
  SDP offer, ≤ 20 KB); `POST /api/ask/voice/hangup`.
- **Console** `POST /api/console/login` `{ password }`, `POST /api/console/logout`, `GET
  /api/console/overview`, `GET /api/console/sessions?state=`, `GET /api/console/sessions/:id`,
  `POST /api/console/sessions/:id/end|lock`, `GET|POST /api/console/settings`, `POST
  /api/console/playground` `{ text, sessionId? }`, `POST /api/console/redteam`. Every POST needs
  the `av_console` cookie, `Origin` equal to `PUBLIC_ORIGIN` and `X-Console: 1`.
- **Settings** (console, stored, audited; defaults from `ASK_*`): answer model and effort, guard
  model and effort (a model is `provider/id` from Pi's catalogue, provider among `openai`,
  `anthropic`, `mistral`, `deepseek`, and offered only when its key is set), the limits below,
  voice on or off.

| Limit (default)                     | Variable                     |
| ----------------------------------- | ---------------------------- |
| Session length 30 min, idle 10 min  | `ASK_SESSION_MAX_MINUTES`, `ASK_SESSION_IDLE_MINUTES` |
| 40 messages per session             | `ASK_SESSION_MAX_MESSAGES`   |
| 6 model calls per message (agent)   | `ASK_MAX_MODEL_CALLS`        |
| 0.50 USD per session, 5 USD per day | `ASK_SESSION_BUDGET_USD`, `ASK_DAILY_BUDGET_USD` |
| 6 new sessions per hour, 10 messages per minute, per address | fixed |
| Voice 5 min per session, 30 min per day | `ASK_VOICE_MAX_MINUTES`, `ASK_VOICE_DAILY_MINUTES` |

Costs are in USD because providers bill in USD and Pi's prices are USD.

## Outputs

- **Message answer:** `text/event-stream` of `stage` (`gate`, `context`, `guard`, `agent`,
  `output` with `allow` or the refusal reason), `tool` (name, start or end), then one `final`
  `{ text, widgets: [{ resourceUri, structuredContent }], mode, score, endsAt }` or one `error`.
  A refused message is a normal `final` answer with a fixed polite text, never the model's.
- **Session view:** `{ state: active | ended | locked | none, endsAt, mode: normal | strict,
  signedIn, connected, voice: { available, unlocked }, messages: [{ role, text, widgets, at }] }`.
  A shopper never sees scores, verdicts, models, costs or other sessions.
- **Errors** (JSON `{ error, message }`): `ask_disabled` 503 (no answer model with a key, or the
  switch off), `budget_exhausted` 503 (daily budget spent, until 00:00 UTC), `rate_limited` 429
  with `retry-after`, `session_ended` 409 with `reason` (`time`, `idle`, `messages`, `budget`,
  `signed_out`, `other_customer`, `ended_by_shopper`, `ended_by_console`), `session_locked` 423,
  `invalid_request` 400, `session_busy` 409 (a message of this session is still being answered),
  `not_signed_in` 401 (connect), `strict_mode` 403 (connect in strict
  mode), `voice_unavailable` 404, `invalid_password` 401, `voice_limit` 429, `voice_failed` 502,
  `widget_tool_refused` 403. Console: `404` when `CONSOLE_PASSWORD` is missing or under 16
  characters, `invalid_password` 401, `rate_limited` 429, `forbidden` 403 (origin, header or
  cookie), `invalid_setting` 400.
- **Refusal texts** (stage, reason): `too_long`, `empty`, `injection_signature`,
  `hidden_characters` (tag characters), `off_topic`, `injection`, `abuse`, `guard_unavailable`,
  `agent_failed`, `model_call_cap`, `output_blocked`. Each is one fixed sentence in the shopper's
  language when it is French, else English.
- **Console:** overview (active sessions, today's cost and budget, cache hit rate per model,
  refusals per stage); sessions with full transcripts, each message's stage verdicts, score
  change, model, effort, usage and cost; settings with an audit line per change; playground answers
  with every stage shown; red-team results (fixed attack list, stage 1 to 3 verdicts).
- **Back Office:** the house agent's MCP calls appear as client "Atelier Velune Ask" on the
  `agent` channel, like any agent's.

## Invariants

1. **Keys stay server-side.** No key, model id or effort reaches a browser; no `"use client"`
   module imports `src/server/ask`. The console shows whether a key is set, never its value.
   Test: `ask/config.test.ts` "keys never serialized"; `ask/api.test.ts` "session view fields".
2. **No privilege.** The agent's only store tools are the store's 13 MCP tools, called in-process
   (`handleHouseMcp`) as a signed-out PAP guest or with the token of the shopper's own grant
   (connected). A payment uses that grant's scopes, budget and step-up exactly as for an outside
   agent. The tool list is the same for every session (the cached prefix); the in-process door
   decides at each call: no tool runs outside a shopper message, `complete_checkout` with a saved
   card needs a connected account and normal mode, card data (a network token) is always refused,
   handing the checkout to the shopper always passes. The house client's tokens live in the
   process's memory only; ending a session revokes its grant. Test: `ask/agent.test.ts` "guest
   has no token", "pay tools only when connected and normal", "no tool runs outside a shopper
   message"; `ask/house.test.ts`.
3. **Five stages, in order, every message,** typed, voiced or sent by a widget's `ui/message`. A
   stage that refuses stops the message: no later stage runs and no model is called after a stage
   1 or 2 refusal. One message at a time per session (`session_busy`). Stages 3 and 4 get the
   gated text, never the raw request. Test: `ask/pipeline.test.ts` "passes them in order", "a gate
   refusal stops at stage 1", "a guard refusal stops before the agent", "one message at a time".
4. **Stage 1 (deterministic security):** NFKC; zero-width and bidi controls removed (score −10);
   tag characters (U+E0000–U+E007F) refuse; over 1,000 characters refuses; a strong injection
   signature (FR/EN list in `gate.ts`) refuses (score −30), a weak one scores −10; a Luhn-valid
   card number, a mod-97-valid IBAN or a "password: …" value is replaced before any model sees it
   (score −5); the delimiters the agent prompt uses are stripped from shopper text; a link to
   another site scores −5. A refused message is kept for the console with the same values
   replaced. Test: `ask/gate.test.ts`, one case per rule, normal and refused;
   `ask/pipeline.test.ts` "no card data is kept".
5. **Stage 2 (deterministic context):** the session is active, within its time, idle, message and
   cost limits, the day within budget, the address within its rates; the mode follows the score
   (normal ≥ 70, strict 40–69, locked < 40; a regular, signed in with a paid order, an account
   at least 7 days old and no lock in 30 days, gets thresholds 10 lower). In strict mode a
   saved-card payment is refused at the call and connect is refused. Test: `ask/context.test.ts`.
6. **Stage 3 (LLM guard)** answers only through one `verdict` call (`allow`, `off_topic`,
   `injection`, `abuse`, reason ≤ 200 characters). Text, a malformed call, a provider error or 8 s
   without an answer is `guard_unavailable`, a refusal: fail closed. `off_topic` −10, `injection`
   −30, `abuse` −40, and each refuses that message whatever the score. Test: `ask/guard.test.ts`
   with Pi's faux provider.
7. **Stage 4 (agent)** has a frozen system prompt per agent version with a canary, no sandbox, no
   subagent, no skill; Flue's `task` tool resolves nothing. Shopper text and facts reach it inside
   delimiters it is told to read as data. At most `ASK_MAX_MODEL_CALLS` model calls per message,
   retries included; the next one never reaches a provider and ends the message
   (`model_call_cap`). Test: `ask/agent.test.ts` "turn cap", "no task child".
8. **Stage 5 (output filter):** the canary in an answer blocks it and locks the session (score 0);
   a link off the store's origin is removed (−5); a card-number pattern is removed; a EUR amount
   neither a tool returned in this session nor the shopper wrote becomes "(price on the card)";
   at most 2,000 characters. Widgets come only from tool results, never from model text. Test:
   `ask/output.test.ts`; `ask/pipeline.test.ts` "the canary in an answer locks the session".
9. **Score per session,** 0–100, starting at 100, +2 per message every stage allowed, never above
   100; regular status never relaxes stage 1, hard limits, payment rules or step-up. Test:
   `ask/context.test.ts` "score".
10. **One session per browser.** A guest who signs in keeps the session, now bound to that
    customer; sign-out, or another customer signing in on the browser, ends it (`signed_out`,
    `other_customer`) and its transcript is no longer shown to that browser. A session id is 128
    random bits; the database keeps only its SHA-256. Test: `ask/sessions.test.ts`.
11. **Every model call is counted:** Flue announces each model request, its own retries
    included, with a `turn_request` event; an execution interceptor admits it only while the
    message's meter is open and under the cap, so a refused request never reaches a provider. The
    SDKs' own retries are off (`maxRetries: 0`). Each `turn` event's usage and the guard's usage
    are added to the message and the session, failed calls included. Test: `ask/runtime.test.ts`
    "the model call meter", "Flue's own retry of a transient error".
12. **Cache-friendly by construction:** system prompt and tool order fixed per agent version and
    mode; model and effort fixed per session at its start; no compaction; facts appended as
    messages. Pi sends `prompt_cache_key` (OpenAI, Mistral) and `cache_control` (Anthropic).
    Test: `ask/agent.test.ts` "same prefix across sessions" (the prompt and tool block a
    provider receives, through Pi's faux provider).
13. **Console:** `CONSOLE_PASSWORD` under 16 characters disables it (404); constant-time compare;
    5 failures per 15 minutes per address; session cookie `av_console` (random, stored hashed, 8 h,
    httpOnly, `SameSite=Strict`, `Secure` on https); POSTs also need the store's origin and
    `X-Console: 1`; pages `noindex`. A settings change writes an audit line. Test:
    `ask/console.test.ts`.
14. **Voice:** offered only when the session's model is OpenAI's and voice is on; unlocked by
    `adyentic` checked on the server (5 tries per 15 minutes per address), per session. The browser
    holds no key: the server creates the GPT-Live session and keeps its sideband. Each delegation
    runs stages 1 to 5 on the transcript and answers with what stage 5 let through; an unexpected
    `session.updated` or the minutes cap ends the call. Test: `ask/voice.test.ts` with a stubbed
    OpenAI.
15. **Widget actions** go to `/mcp` only for `search_catalog`, `get_product`, `lookup_catalog`,
    `create_cart`, `update_cart`, `get_cart`, `create_checkout`, `update_checkout`,
    `get_checkout`, and `complete_checkout` only when connected and normal; anything else is
    `widget_tool_refused`. Test: `ask/api.test.ts` "widget allowlist".
16. **Disabled is safe:** without an answer model whose key is set, the panel shows the assistant
    as unavailable and no route calls a model. Test: `ask/config.test.ts`.

## Determinism

Bounded. Stages 1, 2 and 5, the score, limits, budgets and the console are deterministic code with
unit tests. The guard is bounded (one forced call, a strict parser, unreadable means refuse). The
agent's text is adaptive and never an authority: prices, totals, orders and payments come from the
store's tools and Adyen, and links and amounts pass stage 5.

## Acceptance checks

- `bun run --cwd apps/adyen-agentic-commerce check`: the `src/server/ask` tests above run offline
  with Pi's faux provider and a stubbed `fetch`; no test needs a key.
- In a browser on `localhost:8003`, with a key the owner set: a guest asks for a summer outfit and
  gets the carousel; adds to the bag in the widget; is handed `continue_url`; signs in and keeps the
  conversation; connects through `/device` with a budget; the agent pays with a saved card within
  it; signs out and the panel starts empty. At 375 and 1440 px, light and dark, Firefox, Safari and
  Chrome.
- Red-team list in the console: every case refused at the stage it names.
- `/console`: wrong password five times then 429; model change audited; a session's transcript with
  verdicts and costs.
- Voice, by the owner on an OpenAI session: unlock with `adyentic`, ask for a product by voice,
  the carousel appears in the chat.

## Out of scope

- Keys typed by shoppers, a model or effort picker for shoppers, LiteLLM, OpenCode Go.
- A sandbox, code execution, files, web browsing or subagents for the agent.
- Voice on Anthropic, Mistral or DeepSeek conversations; voice without the password.
- LIVE payments; any payment path the store's MCP tools do not already have.
- Keeping transcripts beyond the store's database (no external tracing or analytics).

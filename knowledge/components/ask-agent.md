---
type: Component
title: "Ask agent: the agentic store's own chat, a Flue agent behind a five-stage gate"
description: "The agentic store's chat for guests and shoppers: a Flue agent shopping over the store's own MCP like any PAP client, server-only keys, a five-stage gate, a score per session, a password console, OpenAI voice."
tags: [component, agentic, ask, flue, llm, security, console, voice]
status: draft
scope: component-ask-agent
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T00:50:00Z
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
  - id: pid-skill
    resource: https://github.com/alexyyyander/prompt-injection-defense/blob/master/skill/SKILL.md
    title: "Prompt-injection defense skill 1.1.0 (MIT): 12 attack families, rules D1 to D10"
  - id: owasp-llm01
    resource: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
    title: "OWASP LLM01:2025 Prompt Injection: prevention and mitigation"
  - id: msft-xpia
    resource: https://learn.microsoft.com/en-us/security/zero-trust/sfi/defend-indirect-prompt-injection
    title: "Microsoft: defend against indirect prompt injection (layers, isolation, least privilege)"
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
| `.env` / Render variables (never read by tooling) | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `CONSOLE_PASSWORD`, `VOICE_MODE_PASSWORD`, `ASK_*` defaults (`.env.example`) | Owner | Boot |
| SQLite (`DATABASE_PATH`)                 | Ask sessions, messages with stage verdicts and costs, console settings and audit log, console sessions, the house client's id | App | Per request |
| Flue's SQLite (`dirname(DATABASE_PATH)/flue.sqlite`) | Flue's own conversation records, one instance per Ask session | Flue | Per submission |
| The store's MCP handler (in-process `handleHouseMcp`, no route) | UCP catalogue, cart, checkout and order tools; widget resources | App | Per tool call |
| Pi's model catalogue (`@earendil-works/pi-ai`) | Model ids, reasoning support, per-million-token prices (USD) | Pi | Package version |
| Model providers (HTTPS)                  | Answers, tool calls, usage (input, output, cache read, cache write) | Provider | Per call |
| OpenAI GPT-Live (`/v1/live/sessions`, sideband WebSocket) | Voice session, transcripts, delegation events | OpenAI | Per call |

## Inputs

- **Shopper message** `POST /api/ask/messages` `{ text: string ≤ 1,000 chars after NFKC, page?:
  store path, bag?: [{ variantId, quantity }] }` (the site's bag: at most 20 lines, catalogue ids,
  1 to 10 each; anything else is dropped), with the `av_ask` cookie (httpOnly, `SameSite=Lax`, `Secure` on https, path
  `/api/ask`) naming the session. The customer comes from the store's own session cookie, never
  from the body. A browser's first message starts its session, with the same checks as `POST
  /api/ask/session`. Every Ask POST needs `X-Ask: 1` (a header no other site can send without a
  CORS preflight the store refuses) and, when the browser sends `Sec-Fetch-Site`, `same-origin`.
- **Session** `GET /api/ask/session` (read, creates nothing); `POST /api/ask/session` (start a new
  one, ending the current); `POST /api/ask/session/end`.
- **Connect** `POST /api/ask/connect` (signed in only) starts a device sign-in for the house
  client and returns the store's `/device` URL with the user code filled in; `GET /api/ask/connect`
  polls it. Tokens never leave the server. **One click** `POST /api/ask/connect/inline`
  `{ spendLimit }` (EUR minor units, an integer from 100 to 100,000; else `invalid_budget` 400),
  same checks as connect: the house client's device request is approved at once for the session's
  signed-in shopper with that budget (`decide`, traced as a consent on this path) and redeemed, so
  the grant is a real one the account page lists and revokes; answered `{ state }`.
- **Widget action** `POST /api/ask/widget` `{ name, arguments }` from a widget in the panel: a
  shopper's tap, forwarded to `/mcp` as the session's identity, allowlist below. A widget's
  `ui/message` is refused: a widget never writes to the agent.
- **Receipt email** `POST /api/ask/checkout-email` `{ checkoutId, email }` or `{ checkoutId,
  account: true }` (signed in: the account's email, read on the server), for a checkout this
  conversation's widgets showed that has no email yet; answered with the checkout as the widget
  sees it. No model, transcript or widget data ever holds the address.
- **Widget frame** `GET /api/ask/widget-frame?uri=` (the carousel or the bag): the widget's HTML
  as JSON, never `text/html`, with a Content-Security-Policy meta (no connection, images from
  `PUBLIC_ORIGIN` only); anything else is `invalid_request`.
- **Voice** `POST /api/ask/voice/unlock` `{ password }`; `POST /api/ask/voice/call` `{ sdp }` (an
  SDP offer starting `v=0`, ≤ 20,000 characters), answered `{ sdp, maxSeconds }`; `POST
  /api/ask/voice/hangup`. From OpenAI's sideband the server reads `session.started`, the input
  transcript, `session.delegation.created`, `session.usage.updated`, `session.updated` and
  `session.closed`; it sends only `session.commentary.append` and `session.close`.
- **Console** `POST /api/console/login` `{ password }`, `POST /api/console/logout`, `GET
  /api/console/status` (200 `{ signedIn }`, asked before the page draws its form), `GET
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
| Voice 10 min per session, 30 min per day | `ASK_VOICE_MAX_MINUTES`, `ASK_VOICE_DAILY_MINUTES` |

Costs are in USD because providers bill in USD and Pi's prices are USD.

## Outputs

- **Message answer:** `text/event-stream` of `stage` `{ stage }` (`gate`, `context`, `guard`,
  `agent`, `output`: progress only, never the verdict), `tool` (name, start or end, label), then
  one `final` `{ text, widgets: [{ resourceUri, structuredContent }], page?, mode, endsAt }` or
  one `error` `{ error }`; `page` is a store path the panel opens after the answer (invariant 21). A refused message is a normal `final` answer with a fixed polite text,
  never the model's. Verdicts and score changes go to the transcript the console reads.
- **Session view:** `{ available, state: active | ended | locked | none, reason, endsAt, mode:
  normal | strict, signedIn, accountEmail?, connected, voice: { available, unlocked }, messages:
  [{ role, text, widgets, page?, at }] }`; an ended session shows no messages; `page` is the store
  path a voiced answer asked to open (stage 5 let it through), so the call can open it; a typed
  answer's page opened from its own stream and is not repeated here. `accountEmail` is the
  signed-in account's email masked (first letter and domain, `b•••@example.com`), for the receipt
  block only.
  A shopper never sees scores, verdicts, models, costs or other sessions.
- **Panel:** the Personal Shopper (ADR-019). A "Personal Shopper" button in the header (icon only
  under 640 px) or Cmd/Ctrl+K opens it on the composer (the shortcut minimises it from the
  composer; `askLogic.test.ts` "Cmd or Ctrl+K"). From 1024 px it is a 440 px rail and the page makes
  room for it (the header then hands its departments and Developers links to the Menu below a
  1720 px screen); below, a sheet of 55 % of the screen over a dimmed page, 92 % with "Make it
  bigger", which is full screen from 1024 px. Below 1024 px a product or checkout page the shopper
  opens minimises it (`askLogic.test.ts` "below 1024 px a product or checkout page"). Its header
  names the page's help ("Here to help with this piece" and so on), three questions fit the page
  as chips (empty conversation, and above the composer after), a bar shows the site bag's count
  with "View bag", and the widget, the delivery block and the receipt block read as one card.
  Escape minimises it; it reopens, open or minimised, after a reload in the same tab. It is absent on `/console`, `/back-office`, `/consent`,
  `/device` and `/oauth`. Answers are light Markdown parsed to data and drawn by React (no HTML;
  a link opens in place only to a page `open_page` may open, the list of invariant 21; any other
  address, the owner's pages and a path whose dot segments collapse into `//` show as plain text). Each widget runs in a sandboxed
  `srcdoc` frame (`allow-scripts` only, so an opaque origin) as an MCP Apps host: `ui/initialize`
  with the page's theme, `tools/call` sent to `POST /api/ask/widget`, `ui/message` refused,
  `ui/open-link` for the store's pages only (opened as the panel opens a page, below), size
  changes clamped to 120 to 900 px. The carousel is compact (about two cards across the panel)
  and each card has "Show details", which opens the product's page; in ChatGPT it opens as a link. Chromium refuses an opaque-origin frame's requests to a loopback address, so the host
  fetches the store's own images (`PUBLIC_ORIGIN/api/art/*.svg`, at most 64 per data) from the page
  and hands them to the widget as `data:` URLs, in its data and in its tool answers; one it cannot
  fetch keeps its address. The conversation holds one widget, under the newest message that
  showed one: every carousel and bag the agent shows, in order, and every answer to the widget's
  own taps land in it, so it keeps the collection and the bag and shows the newest; an earlier
  message keeps a line ("Collection shown", "Bag shown"). When the bag's checkout lacks a receipt
  email, a block under the widget asks for it, drawn by the panel itself: signed in, the account's
  email goes on at once ("Use this email" and "Another email" only after a failure); a guest types one, or
  taps "I have an account" to sign in inside the block (email prefilled from what was typed,
  password or passkey, the browser's own autofill offered), and the account's email is then used
  without leaving the chat (the header's account menu follows); the block opens on that sign-in
  when this browser signed in here before. Whether an email has an account is never shown (no
  account enumeration). A bag shown before a reload can be older than its checkout: when the
  store refuses an email because one is set, the block re-reads the checkout (`get_checkout`)
  and closes once the bag needs none. While the newest bag's checkout can still change (incomplete,
  needing review or ready), a delivery block under the widget offers Standard, Express or a pickup
  point with the store's preset addresses or pickup points, preselected; the choice goes to the
  store's own `POST /api/checkouts/:id/delivery`, never to the model, and the widget then re-reads
  the checkout (`get_checkout`) for the store's new total (`askLogic.test.ts` "site bag").
  **One bag per browser:** when the widget shows an open bag, the site's bag (header count,
  `/cart`) takes its lines and the open checkout page hears of it at once; a completed bag empties
  the site's bag. The agent hears the site's bag in `<shop_context>` as `bag:` with catalogue titles
  and ids; on a `/checkout/chk_…` page, that checkout's lines instead (open, and the session's
  account's or no account's). It also hears `viewing:` (a product page's title, id and subtitle),
  `signed in`, `account connected`, `autonomous pay` (yes only with a live grant that may pay, budget
  left and normal mode), `budget left` and `saved cards` (counted, for a connected session only);
  the prompt (agent `ask-5`, "Personal Shopper") never asks a signed-in shopper to sign in or for an
  email (`ask/pipeline.test.ts` "the shop context").
  When voice is offered, a round icon of five bars beside Send shows from the panel's first
  opening, before any message; it asks for the password (unlocking starts the conversation when
  none runs), then starts a
  call (microphone, WebRTC to OpenAI with the server's answer, a data channel that only listens).
  A microphone that does not start names its cause: blocked for the site only when the browser
  reports the site's permission as denied, else the system's privacy settings, an unanswered
  prompt, no microphone, one busy in another app, or a browser that gives the page none
  (`askLogic.test.ts` "microphone problems"). While the call runs its bars move (still with reduced motion) and it hangs up, a microphone
  button on its left mutes and unmutes the shopper (the call and its minutes go on), and a bar
  above the composer shows the countdown, the last caption and End; the composer waits and the
  conversation refreshes every 3 s. Closing the panel, a page without it, an inactive session or
  voice no longer offered (out of normal mode) hangs up. A call's end is a note "Voice call ended".
  **Minimised:** the header's "Minimise" button, Escape, or the site header's Personal Shopper
  button while the panel is open shrinks it to a bar at the bottom right (full width under 1024 px) that hides the
  conversation and keeps everything else running: an answer being written, a voice call, the
  widget, a device sign-in. The bar shows the title, what the assistant is doing or the start of
  its last answer (two lines), the voice bar with its countdown and End while a call runs, and the
  composer; "Open the conversation" restores the panel and Close closes it (closing ends a call).
  The page is neither dimmed nor narrowed while the panel is minimised, and its end scrolls above
  the bar.
  **Opening a page:** nothing navigates by itself: a page opens only when the shopper asked for it
  (an answer that carries `page`) or tapped a widget's button. When an answer carries `page`, the
  panel opens it in place after showing the answer, only if it passes the same list in the
  browser; during a voice call, the refresh opens the page of each voiced answer stored after the
  call started (by the server's clock, read when it starts; none before that), once. Below 1024 px the panel then minimises so the page shows; from 1024 px
  it stays docked, leaving full screen if it was. The panel's fields use 16 px text on touch
  screens, so Safari on iPhone does not zoom when one takes focus.
- **Errors** (JSON `{ error, message }`): `ask_disabled` 503 (no answer model with a key, or the
  switch off), `budget_exhausted` 503 (daily budget spent, until 00:00 UTC), `rate_limited` 429
  with `retry-after`, `session_ended` 409 with `reason` (`time`, `idle`, `messages`, `budget`,
  `signed_out`, `other_customer`, `ended_by_shopper`, `ended_by_console`), `session_locked` 423,
  `invalid_request` 400, `session_busy` 409 (a message of this session is still being answered),
  `not_signed_in` 401 (connect), `strict_mode` 403 (connect in strict
  mode), `voice_unavailable` 404 (switch off, no OpenAI key, no `VOICE_MODE_PASSWORD`, another provider,
  strict mode),
  `voice_locked` 403 (not unlocked), `invalid_password` 401, `voice_limit` 429 (fewer than 30 s
  left), `voice_failed` 502 (OpenAI refused or the sideband did not attach), `session_busy` 409
  (a call is already running),
  `widget_tool_refused` 403, `store_refused` 409 (the store refused a widget's call, or the
  checkout already has an email), `checkout_unknown` 404 (a checkout this conversation did not
  show), `invalid_email` 400, `forbidden`
  403 (no `X-Ask: 1`, or another site). Console: `404` when `CONSOLE_PASSWORD` is missing or under 16
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
   Test: `ask/config.test.ts` "keys never serialized"; `ask/api.test.ts` "session view fields";
   `ask/console.test.ts` "no browser module imports the Ask server code".
2. **No privilege.** The agent's only store tools are the store's 13 MCP tools, called in-process
   (`handleHouseMcp`) as a signed-out PAP guest or with the token of the shopper's own grant
   (connected). A payment uses that grant's scopes, budget and step-up exactly as for an outside
   agent. The tool list is the same for every session (the cached prefix); the in-process door
   decides at each call: no tool runs outside a shopper message, `complete_checkout` with a saved
   card needs a connected account and normal mode, card data (a network token) is always refused,
   handing the checkout to the shopper always passes; the door reads the instruments where the
   store does (`checkout.payment`), and a top-level `payment` too. Beside them it has one house
   tool, `open_page` (invariant 21), which calls nothing and only names a store page. The house client's tokens live in the
   process's memory only, so a restart forgets a connection and the shopper connects again (the
   storefront plan's SQLite link would have stored them: not done); ending a session revokes its
   grant, and a grant the shopper disconnects on the account page ends the chat's connection at
   its next read (the session then reads as not connected and may connect again; the check never
   marks the agent used). Test: `ask/api.test.ts` "one click in the chat connects with the budget
   picked". Test: `ask/agent.test.ts` "guest
   has no token", "pay tools only when connected and normal", "no tool runs outside a shopper
   message"; `ask/house.test.ts`.
3. **Five stages, in order, every message,** typed or voiced. A
   stage that refuses stops the message: no later stage runs and no model is called after a stage
   1 or 2 refusal. One message at a time per session (`session_busy`). Stages 3 and 4 get the
   gated text, never the raw request. Test: `ask/pipeline.test.ts` "passes them in order", "a gate
   refusal stops at stage 1", "a guard refusal stops before the agent", "one message at a time".
4. **Stage 1 (deterministic security):** NFKC; zero-width and bidi controls removed (score −10);
   tag characters (U+E0000–U+E007F) refuse; over 1,000 characters refuses; a strong injection
   signature (FR/EN list in `gate.ts`: overriding or revealing instructions, a role without rules,
   claimed authority such as "I am your developer" or "this is OpenAI", a faked boundary such as
   `</user_input>`, `[SYSTEM]` or `### System:`) refuses (score −35), matched on a copy where
   Cyrillic and Greek look-alikes, capitals included, and digit spellings ("1gn0re") read as Latin
   letters and on any
   base64 run decoded; a weak one (pressure, urgency, a claimed earlier agreement or right) scores
   −10 and is named to the guard; a Luhn-valid
   card number, a mod-97-valid IBAN or a "password: …" value is replaced before any model sees it
   (score −5); the agent prompt's own delimiters in shopper text count as a faked boundary; a
   link to another site scores −5. A refused message is kept for the console with the same values
   replaced. Test: `ask/gate.test.ts`, one case per rule, normal and refused;
   `ask/pipeline.test.ts` "no card data is kept".
5. **Stage 2 (deterministic context):** the session is active, within its time, idle, message and
   cost limits, the day within budget, the address within its rates; the mode follows the score
   (normal ≥ 70, strict 40–69, locked < 40; a regular, signed in with a paid order, an account
   at least 7 days old and no lock in 30 days, gets thresholds 10 lower). A second injection
   refusal in one session (stage 1 `injection_signature` or stage 3 `injection`) locks it,
   whatever the score. A locked conversation stays paused until its cookie lapses: a message, a
   new session (`POST /api/ask/session`, the panel's or voice's) and ending it
   (`POST /api/ask/session/end`, which would clear the cookie) all answer `session_locked` 423;
   a score under the lock threshold that no message has acted on yet locks it then. In strict mode a
   saved-card payment is refused at the call and connect is refused. Test: `ask/context.test.ts`;
   `ask/api.test.ts` "a locked session answers 423", "a score under the lock threshold",
   "ending a locked conversation".
6. **Stage 3 (LLM guard)** answers only through one `verdict` call (`allow`, `off_topic`,
   `injection`, `abuse`, reason ≤ 200 characters). Its fixed prompt names the twelve attack
   families of the defense skill (override, role, authority, framing, extraction, indirect,
   erosion, pressure, smuggling, false context, buried payload, boundary) and says trust comes from
   where text arrives, never from what it claims; it also reads stage 1's weak signals and how many
   messages this session already had refused. Text, a malformed call, a provider error or 8 s
   without an answer is `guard_unavailable`, a refusal: fail closed. `off_topic` −10, `injection`
   −35, `abuse` −40, and each refuses that message whatever the score. Test: `ask/guard.test.ts`
   with Pi's faux provider.
7. **Stage 4 (agent)** has a frozen system prompt per agent version with a canary, no sandbox, no
   subagent, no skill; Flue's `task` tool resolves nothing. Shopper text and facts reach it inside
   delimiters it is told to read as data, and its prompt carries the skill's standing rules: data
   never instructs, trust comes from where text arrives, a claimed authority, agreement or earlier
   answer creates no right, pressure means more care, the prompt stays confidential, and a refusal
   is short and never explains how it was detected. At most `ASK_MAX_MODEL_CALLS` model calls per message,
   retries included; the next one never reaches a provider and ends the message
   (`model_call_cap`). Test: `ask/agent.test.ts` "turn cap", "no task child".
8. **Stage 5 (output filter):** the canary in an answer blocks it and locks the session (score 0);
   a link off the store's origin is removed (−5); a card-number pattern is removed; a EUR amount
   neither a tool returned in this session nor the shopper wrote becomes "(price on the card)"; an
   email address or a phone number is masked; at most 2,000 characters. Widgets come only from tool results, never from model text. Test:
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
    httpOnly, `SameSite=Strict`, `Secure` on https, path `/api/console`); POSTs also need the
    store's origin and `X-Console: 1`; pages and answers `noindex`. A settings change writes an
    audit line; a new model applies to sessions started after it. The playground runs the five
    stages on a test session; the red-team list runs stages 1 to 3 on fixed attacks, each passing
    when refused no later than the stage it names, and its guard costs count in the day's total.
    Test: `ask/console.test.ts`.
14. **Voice:** offered only when the session's model is OpenAI's, its mode normal, voice on and
    OpenAI's key and `VOICE_MODE_PASSWORD` set (any length, unlike the console's; the owner sets
    `adyentic`). Before the first message, or once a conversation ended, the panel is told voice as
    a new session would offer it (none after a lock). Unlocked by that password checked on the
    server as two digests (5 wrong tries
    per 15 minutes per address), per session. The browser holds no key and steers nothing: the
    server creates the GPT-Live session with client delegation and
    `allowed_client_events: []`, attaches its sideband before answering the SDP, and keeps one
    call per session. Each delegation runs stages 1 to 5 on the last 1,000 characters heard and
    the voice gets only what stage 5 let through, without Markdown or links (at most 1,200
    characters); sideband events replayed on attach count once. A call lasts at most the least of
    the session's and the day's voice minutes (running calls reserve theirs), both budgets at
    0.05 USD a minute, and the session's time left; the cap, an unexpected `session.updated`, an
    ended session, a session out of normal mode or the switch turned off closes it. The voice
    is told to stay silent and not delegate when the shopper is talking to someone else, and a
    delegation reaches the agent with the fact that it is a voice transcript that may hold words
    meant for someone nearby (judged by the models, best effort). Muting stops the browser's
    microphone track only. Its seconds and cost land on the session and
    on a note the day's totals count, even when the sideband is lost. The voice model's own words
    outside a delegation pass no stage: it has no tool, its instructions keep it to the shop, the
    shopper sees its captions, and the minutes cap bounds it. Test: `ask/voice.test.ts` with a
    stubbed OpenAI; `ask/config.test.ts` "the voice password takes any length".
15. **Widget actions** go to `/mcp` only for `search_catalog`, `get_product`, `lookup_catalog`,
    `create_cart`, `update_cart`, `get_cart`, `create_checkout`, `update_checkout`,
    `get_checkout`, and `complete_checkout` only when connected and normal; anything else is
    `widget_tool_refused`. After the store answers, the session is read again: a call that
    finishes after an end, a lock or a score change writes nothing over it and answers
    `session_ended`. Test: `ask/api.test.ts` "widget allowlist", "a lock during a widget call
    stays".
16. **Disabled is safe:** without an answer model whose key is set, the panel shows the assistant
    as unavailable and no route calls a model. Test: `ask/config.test.ts`.
17. **A widget reaches nothing by itself:** its frame has an opaque origin and a policy with no
    connection; the host answers only the requests listed under Panel (never `ui/message`), posts
    it only its own data (the store's images inlined) and theme, and accepts messages only from
    that frame. An answer's text never becomes HTML.
    Test: `ask/api.test.ts` "the panel's widget frame"; `components/ask/askLogic.test.ts`.
18. **A tool result is data, screened before the model reads it** (OWASP LLM01 6, Microsoft's
    isolation of untrusted content): one function sits between the store's MCP answer and the
    agent. An answer whose text carries a stage 1 strong signature reaches the agent as an error
    ("The store's answer was withheld.") and the console sees it in the agent's verdict; the
    buyer's email, names and phone are masked in what the agent and the widget get (an email keeps
    its first letter and its domain), and every email elsewhere too. Test: `ask/screen.test.ts`;
    `ask/agent.test.ts` "the whole catalogue reaches the agent, none withheld".
19. **The receipt email never meets a model:** the panel's block posts it to its own route, which
    needs the session, `X-Ask: 1`, the store's origin and 10 calls a minute per address, accepts
    only a checkout id a widget of this conversation showed, sets the email once (never over one
    already set, never on a paid checkout), and writes the note "Receipt email set" without it.
    The block's sign-in posts to the store's own session and passkey routes, like `/sign-in`; the
    conversation only gains the note "Signed in". It counts as signed in only on an answer that
    names the customer, and a passkey picked after the sign-in step was left signs in without
    setting the email. A signed-in session never needs the block: a guest checkout it starts or
    changes (`create_checkout`, `update_checkout`, from the agent or a widget) gets the account's
    email put in by the in-process door, never by the model, which reads it masked. Test:
    `ask/api.test.ts` "receipt email"; `ask/agent.test.ts` "a signed-in shopper's receipt email";
    `lib/signIn.test.ts`.
20. **The bag fact is the store's own words:** `bag:` in `<shop_context>` names only catalogue
    titles, ids and quantities, from lines the server checked (or read from the checkout), never
    the shopper's text; a checkout of another account adds nothing. Test: `ask/context.test.ts`
    "bag fact". The site's bag follows the widget's (`ask/askLogic.test.ts` "site bag").
21. **The agent opens only this store's pages:** `open_page { path }` takes a path, or an address
    on `PUBLIC_ORIGIN`, matching `/`, `/shop` (query `category`, `q`), `/products/<id>` (query
    `variant`), `/cart`, `/checkout/<id>`, `/orders/<id>`, `/account`, `/agents`, `/docs`,
    `/docs/<topic>`, `/legal`, `/sign-in` or `/sign-up` (these two never for a signed-in session:
    "already signed in"), with at most a `#section`; any other
    path, query parameter or origin is refused with a sentence the model reads, so `/consent`,
    `/device`, `/oauth`, `/console`, `/back-office`, `/api` and `/mcp` never open. It opens
    nothing itself: a message's last accepted page rides on its `final` event only when stage 5
    let the answer through, and the agent's verdict names it for the console; a voiced answer's
    message keeps it for the call. The agent calls it only when the shopper asks to go to a
    page. Outside a shopper message or voice delegation (a widget's tap), and in an ended or
    locked session, it is refused. The panel checks the page again with the same list, and a link
    in an answer opens in place only to a page on it. Test:
    `lib/storePages.test.ts`; `ask/agent.test.ts` "open_page"; `ask/pipeline.test.ts` "a blocked
    answer opens no page"; `ask/voice.test.ts` "a voiced answer keeps its page"; `ask/api.test.ts`
    "a store page the agent opens reaches the browser";
    `components/ask/askLogic.test.ts` "store links only", "voice pages".

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
- The carousel's and the bag's images show in the panel on `127.0.0.1:8003` as on the public
  origin (the host inlines them).
- Red-team list in the console (16 cases, the skill's benchmark among them): every case refused
  at the stage it names.
- `/console`: wrong password five times then 429; model change audited; a session's transcript with
  verdicts and costs.
- Voice, by the owner on an OpenAI session: before any message, unlock with `adyentic`
  (`VOICE_MODE_PASSWORD`), ask for a product by voice,
  the carousel appears in the chat; say "take me to my bag", `/cart` opens; mute, speak, nothing is
  heard; unmute.
- At 375 and 1440 px, light and dark: minimise during an answer and during a voice call, both
  carry on and the bar shows them; navigate and reload, the bar stays; "take me to my account"
  opens `/account` (the panel minimises at 375 px, stays docked at 1440 px); a link to another
  site in an answer shows as text; "Show details" on a carousel card opens the product's page; on
  an iPhone, focusing the composer or the receipt email does not zoom; a guest with an account
  signs in inside the receipt block and the receipt takes the account's email.

## Out of scope

- Keys typed by shoppers, a model or effort picker for shoppers, LiteLLM, OpenCode Go.
- A sandbox, code execution, files, web browsing or subagents for the agent.
- Voice on Anthropic, Mistral or DeepSeek conversations; voice without the password.
- Opening a page the shopper did not ask for (no automatic navigation); opening or linking any
  page of another site.
- Telling a shopper whether an email has an account.
- LIVE payments; any payment path the store's MCP tools do not already have.
- Keeping transcripts beyond the store's database (no external tracing or analytics).

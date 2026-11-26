# Changelog

Every notable change, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[SemVer](https://semver.org/)).

## [Unreleased]

## [0.8.0] - 2026-11-26

- Fix the findings of the release's security review of the payment lock. An agent's refused or
  failed payment no longer reopens a checkout whose order, or amount mismatch, a webhook recorded
  while the call was in flight, nor one the shopper's Drop-in has claimed since, and a pending
  answer reports the checkout as it stands. A pending Drop-in payment that Adyen later answers as
  refused, canceled or expired reopens its checkout, as the refusal webhook would, unless it is
  held as a mismatch. The same payment form claiming again keeps the payer its first claim named,
  or names the shopper who signed in since. `docs/KNOWN_LIMITS.md` now says what a checkout's link
  lets its holder do.

- Run the Ask agent's MCP client on `@modelcontextprotocol/client` 2.3.1 instead of the 2.0.0
  that Flue 2.3.1 pins, through a root `overrides` entry: 2.0.0 carries GHSA-6prh-2h8m-c8cw
  (redirects to another origin re-sent headers and bodies) and GHSA-6qxp-vccf-f47h (OAuth
  credentials sent to an authorization server the MCP server names), which CI's OSV scan refuses.

- Fix four findings of the independent review of the agentic store. The Ask agent's payment check
  now reads the instruments where the store does (`checkout.payment`), so strict mode, an
  unconnected account and card data are refused again. Code Mode counts store calls as they
  start, so `Promise.all` cannot pass the 20-call cap, and a host-side error ends a run at once.
  A widget call no longer reactivates a session locked while it ran. Capital Cyrillic and Greek
  look-alikes now meet the injection signatures. A second tab can no longer open a payment form while
  another tab's payment holds the checkout, which kept that payment's refusal from reopening it.
  A signed-in shopper paying a guest bag now also holds their account's other payments, until
  Adyen settles that payment; once it is released or refused, or an agent pays that bag instead,
  the shopper's account is free again.
- Add a ten-minute demo to the agentic `/docs` overview: eight stops, each saying what to do and
  what to point out. The local PAP agent script ends an over-budget run by printing the shopper's
  link instead of a stack trace.
- Explain every agentic `/docs` page in plain words: before each diagram, what it is about and
  how to read it; after it, what to remember; and a short glossary on the overview, written for a
  visitor who is not technical.
- Add Code Mode at `/mcp/code` (Cloudflare's pattern): two tools, `search` and `execute`, where
  an agent sends one short JavaScript function that calls the store's own MCP tools and gets only
  its result back. The code runs in a fresh QuickJS WebAssembly sandbox (no network, files or
  timers; 32 MB, half a second of interpreter time, 20 store calls, 10 runs a minute per address);
  every call carries the agent's own token, and paying stays a direct call on `/mcp`. `/mcp/code`
  is a third OAuth resource; `/docs/code-mode` explains it and `scripts/pap-agent.ts --code-mode`
  shows it end to end.
- Speak to shoppers in plain words: every refusal on the store's browser routes and every
  checkout message reads as one sentence from a single table (never an agent text such as a field
  name), and a browser that was once signed in greets the shopper back: "Welcome back" on
  sign-in, "Sign in instead" on sign-up, a sign-in link beside the receipt fields, and the
  account's own email filled in when signed in.
- Keep one bag per browser: the Ask panel's bag becomes the site's bag (header count, `/cart`), a
  paid one empties it, and the open checkout page follows it at once (a site checkout takes the
  bag's lines through `POST /api/checkouts/:id/lines`, an agent's checkout refreshes, every 4 s
  as well) and reloads Drop-in for the new total. The agent hears the site's bag, or the open
  checkout's, as catalogue titles and ids. One account now pays one checkout at a time, across
  the website and every agent.
- Pay one way at a time: the checkout page's Drop-in holds the checkout for its payment before it
  sends it (`POST /api/checkouts/:id/pay-intent`, 15 minutes), so an agent's or the Ask panel's
  `complete_checkout` sends nothing meanwhile, edits and cancels wait, a second tab is refused, and
  a bag changed since the form opened reloads the form instead of paying the old total; a result
  or a refusal webhook frees it. The store spec's MCP Apps parts move to their own spec.
- Ask the receipt email in the Ask panel itself: when the bag's checkout lacks one, a block under
  the widget offers the account's address (shown masked) or takes a typed one, and posts it to
  `POST /api/ask/checkout-email`, never through the assistant; the route takes only a checkout
  this conversation showed, sets the email once and keeps it out of the transcript.
- Keep one widget in the Ask panel: the carousel and the bag share one frame under the newest
  message that showed one, fed every view the agent or a tap brought, while earlier messages keep
  a line. The widget loses its "By hand" / "With the assistant" switch and its TEST note: its
  buttons call the store's tools and never write to the assistant, in the panel and in ChatGPT.
- Tighten the Ask agent against prompt injection, after the prompt-injection-defense skill, OWASP
  LLM01:2025 and Microsoft's indirect-injection guidance: stage 1 also refuses claimed authority,
  faked boundaries, a role without rules, look-alike letters, digit spellings and base64 payloads,
  and names its weak signals to the guard; the guard knows the twelve attack families and the
  session's earlier refusals; a second injection locks the session; the agent's prompt carries the
  standing rules; store answers carrying an injection are withheld from the agent and buyer data
  is masked in them; answers mask emails and phone numbers; the red team grows to 16 attacks.
- Show the product pictures in the Ask panel's carousel and bag: the panel hands the store's own
  images to the widget inline, because Chromium refuses its sandboxed frame's requests to a
  loopback store; the widget draws a base64 `data:image/` picture besides the store's own.
- Let the agentic store's checkout page ask for a missing receipt email: a checkout an agent
  handed over as a guest no longer stops at "missing details"; the email fills that gap once and
  never replaces one already set.
- Declare the Ask agent's secrets on the agentic store's Render service: the four model keys and
  the console password, each set by hand in the dashboard; the deploy runbook says what each one
  turns on.
- Add the Ask agent's GPT-Live voice mode on OpenAI conversations: unlocked with its password,
  checked on the server; the server creates each call with OpenAI's key and keeps its sideband,
  so the browser holds no key and can send no command; every spoken request runs the same five
  stages and the voice says only what they let through; calls stop at the session's and the day's
  voice minutes and budgets, and their seconds count in the day's cost. The panel gets a voice
  button, live captions and a countdown; the store's pages may now ask for the microphone.
- Add the Ask agent's panel on the agentic store: an Ask button in the header opens a right
  sidebar (the page makes room on wide screens), a sheet on phones, or full screen; answers stream
  their progress, then light Markdown drawn without HTML; the store's carousel and bag run inside
  it as MCP Apps widgets in sandboxed frames, their taps sent through `/api/ask/widget` and their
  messages through the five stages; a signed-in shopper connects the account from it.
- Add the Atelier Velune console page at `/console` (not found without a console password, never
  indexed): an overview of today's sessions, cost against the daily budget, cache reads and
  refusals; the sessions with each transcript and its verdicts; model, effort and limit settings
  offering only providers with a key, sending only what changed; the playground and red team.
- Add the Atelier Velune console's server side under `/api/console`: a password sign-in that
  exists only with a `CONSOLE_PASSWORD` of 16 characters or more, five tries per 15 minutes, a
  strict cookie; today's sessions, cost, cache reads and refusals; every session's transcript with
  its verdicts, and ending or locking one; audited model and limit settings; a playground and a
  red-team list that run the gate on demand.
- Add the Ask agent's shopper routes under `/api/ask`: the session (read, start, end), a message
  answered as a stream of stage progress, tool steps and one final answer, connecting the account
  through the store's own device sign-in, and widget taps limited to shopping tools. They refuse
  calls from other sites and never show a score, a verdict, a model or a cost.
- Add the Ask agent's house agent and message pipeline: a Flue 2.3.1 agent shops through the
  store's own MCP handler in-process, as a signed-out guest or with the shopper's own device-grant
  token, never with card data; the five stages run in order with one message at a time per
  session, refused text is kept redacted, and every model call, Flue's retries included, is
  counted and stopped at the cap before it reaches a provider.
- Add the Ask agent's LLM guard and output filter: stage 3 asks a small model for exactly one
  `verdict` call (allow, off topic, injection, abuse) and refuses on anything else, an error or
  8 s of silence; stage 5 blocks an answer that leaks the prompt's canary, drops links off the
  store, removes card numbers, replaces EUR amounts no tool returned and caps answers at 2,000
  characters. ADR-012 names the store's new pins.
- Add the Ask agent's deterministic stages: stage 1 normalizes a message, refuses tag characters,
  over-long text and strong injection phrasings in English and French, removes hidden and bidi
  characters and the prompt's delimiters, and replaces card numbers, IBANs and passwords before
  any model; stage 2 checks the session's message, cost and daily limits and the per-address
  rate, and sets the mode from the session score (normal, strict, locked; 10 points of relief for
  regular shoppers). Refusals answer one fixed sentence in French or English.
- Add the Ask agent's browser sessions: one per browser behind an `av_ask` cookie of 128 random
  bits stored only as a hash; a guest who signs in keeps the conversation, sign-out or another
  customer ends it; time and idle limits; per-address limits for new sessions, messages and
  password tries; the regular-shopper test (paid order, 7-day account, no lock in 30 days).
- Add the Ask agent's configuration: `src/server/ask/config.ts` reads which provider keys are set
  (never their values), the answer and guard models and efforts, the limits within fixed ranges
  and the console password (16 characters or the console is off); `settings.ts` lets the console
  override them, refuses a model whose provider has no key, ignores a stored one whose key went
  away and audits each change. `.env.example` lists every new variable. Adds `@flue/runtime`
  2.3.1's companions `@earendil-works/pi-ai` 1.6.0 and `valibot` 1.5.0; on the owner's choice
  `bunfig.toml` exempts Pi 1.6.0's four packages from the 7-day release age until 27 Nov.
- Specify the agentic store's Ask agent before its code: the component doc with its five-stage
  gate, session score, limits, console and voice invariants, ADR-018 (Flue in-process on Bun,
  Pi's OpenAI, Anthropic, Mistral and DeepSeek providers, the store's own MCP as the only tools,
  GPT-Live voice), and its threat table in SECURITY.md.
- Record the v0.7.2 deploy check: PR #19 merged on `main` (`2daf80e`, CI `45572176026` green),
  tag `v0.7.2` published, and Render's deployments of landing, digital, styling and agentic
  succeeded by 07:59:33 UTC. Health, public pages and read-only routes answer on the three apps,
  and the static chunks of digital `/sessions`, styling `/`, the Sessions resume and the agent
  budget form match the release build. No payment, part-paid reload or signed-in budget change
  was run on the public host.

## [0.7.2] - 2026-11-25

- Fix the agentic account page's agent budget: the limit is labelled as a total including what
  was spent, a live line says what a typed limit leaves the agent, + 50/100/300 EUR buttons add
  to it, the phone keyboard's OK saves any total to the cent (the form skips the browser's step
  check, which refused 598.90), Save stays off on an unchanged limit, and a save says what the
  agent can now spend. Before, typing the current limit saved silently and raised nothing.
- Split the agentic store's two largest server modules by responsibility, without changing
  behaviour: `oauth.ts` (1,171 lines) into scopes, shared records, discovery metadata, clients,
  authorize, device and tokens; `commerce.ts` (1,169) into model, pricing, saved cards, carts,
  checkouts, payment, the shopper's browser sessions and webhooks. Each original file now only
  re-exports the same names, so no importer changed. 413 tests pass.
- Group `adyen-agentic-commerce`'s 40 flat server files into domain folders without changing
  behaviour: `core` (config, db, util, trace, outbound, zip), `payments`, `catalog`, `commerce`,
  `accounts`, `oauth`, `ucp`, `mcp` (tools, widgets, plugin), `pap` and `back-office`, each test
  beside its module; `api.ts` and `protocol.ts` stay at the top. The widget bundle is rebuilt
  only for its source hash. 413 tests pass; pages and public endpoints checked on :8003.
- Split `adyen-v6-styling` by area without changing behaviour: the 1,490-line option catalogue
  becomes `src/options` (controls, secured fields, CSS tokens, Drop-in, card, wallets, themes,
  Drop-in props) with the token audit beside it as `css-tokens.test.ts`; the three panel tabs move
  to `src/components/panels`, the Components tab's option groups to their own files; `app.css`
  becomes seven stylesheets in `src/styles`, imported in cascade order. Browser-checked on TEST:
  each tab and its export, the Brazil-only group, light and dark, 375 and 1440 px.
- Split `adyen-digital`'s `FlowWorkbench` (1,485 to 998 lines) without changing behaviour: what
  each flow sends moves to one module per flow in `src/checkout` (`sessions.ts`, `advanced.ts`
  with the partial-payment callbacks, `api-only.ts`, `pay-by-link.ts`, `mit.ts`), the method
  configuration to `methods.ts`, the Eden client and callback shapes to `client.ts`; the Pay by
  Link and MIT forms become `PayByLinkPanel` and `MitPanel`; inspector polling becomes a hook.
  Browser-checked on TEST: Sessions gift card, reload, card Authorised; Advanced gift card and card;
  API only; Pay by Link create and refresh; MIT on a stored card.
- Reorganize `adyen-digital` into readable modules, with no change to routes, URLs, behaviour or
  UI: client components in `components/workbench`, `inspector`, `back-office` and `settings`;
  flow list and checkout helpers in `src/checkout`; shared readers in `src/lib`; `app.css` split
  into 14 stylesheets in `src/styles`, imported in the old cascade order; the 1,139-line
  `server/api.ts` split into one Elysia plugin per flow in `server/routes` and helpers for request
  bodies, order recording, payments and webhook items. Browser-checked on TEST: every page renders,
  a Sessions and an Advanced card payment were Authorised, the Back Office renders in both themes.
- Resume a part-paid Sessions checkout after a reload in `adyen-digital`: `onOrderUpdated`'s
  `sessionData` (Adyen Web 6.48+) is kept in the tab's `sessionStorage` with the session and the
  settings it was made with, and the next start mounts Adyen Web on that session instead of
  creating one. The order from the setup answer is applied again so Pay shows what is left (6.48.1
  showed the full amount), a refusal's `sessionData` replaces the kept one, and leaving the page
  re-reads `checkout.session.data` so Drop-in's "Supprimer" is not undone by a reload. The entry is
  dropped on completion, a closed or expired session, changed settings or "New payment".
  Browser-verified on TEST with Components and Drop-in.
- Record the v0.7.1 deploy check: after PR #18 merged cleanly on `main` (`10b59cb`, CI
  `44434136862` green) and tag `v0.7.1` published, Render's `agentic-commerce` deploy succeeded at
  01:06:53 UTC (`dep-dbv4mejm8hqs73almun0`). `/healthz` (agentic, digital, styling),
  `/docs/chatgpt`, `atelier-velune-plugin.zip` (5 clean files with `$schema` and OpenAI CIMD
  metadata), `POST /api/return` (cross-site 303 to `/account`, 400 on external origin) and
  signed-out `POST /mcp` (401) passed live checks; ChatGPT Refresh and live card-save/checkout
  await the owner's test.

## [0.7.1] - 2026-11-19

- Fix the ChatGPT widget checkout and composer state: once `ui/initialize` finishes, `bridge.ts`
  ignores stale `openai:set_globals` `toolOutput` snapshots that were reverting `create_checkout`
  back to the cart, deduplicates repeated host payloads, writes context silently through
  `window.openai.setWidgetState` instead of filling ChatGPT's composer via `ui/update-model-context`,
  and falls back cleanly on `openExternal` and JSON text tool responses.
- Bump the MCP Apps widget URIs to `product-carousel-v2.html` and `cart-checkout-v2.html` so
  ChatGPT reloads the updated bundle on Refresh while keeping `-v1` URI aliases in `resources/read`,
  add a "Show all items" empty-carousel action and clear no-saved-card actions (`Pay on Atelier
  Velune`, `Save a test card`, `Refresh cards`), and advertise boutique stylist `instructions` plus
  the `personal-stylist` prompt (`prompts/list`, `prompts/get`) directly over `/mcp`.
- Fix `/account` card saving and 3DS return handling: add a same-origin `/api/return` (`GET` and
  `POST`) bridge outside cross-site form blocks, look up `sessionId` by stored reference without
  creating a stray second Adyen session on redirect return, defer Drop-in unmount outside Adyen's
  `onPaymentCompleted` tick, retry once in production for newly saved cards, and add `app/error.tsx`.
- Update `atelier-velune-plugin.zip` (`mcp.json` and `plugin.json`) with the Agent Plugins
  `$schema`, OpenAI OAuth CIMD auth block, valid `category` (`Other`), 30-char `shortDescription`,
  `supportURL` and array `defaultPrompt`, and clarify `/docs/chatgpt`.
- Record the v0.7.0 deploy check: after PR #17 merged cleanly on `main` (`1413879`, CI green) and
  tag `v0.7.0` published, Render's `agentic-commerce` deploy succeeded at 22:52:56 UTC.
  `/healthz`, `/docs/chatgpt`, `atelier-velune-plugin.zip` (5 files, clean archive targeting prod
  `/mcp`), and signed-out `POST /mcp` (401) passed live read-only checks; the live test in ChatGPT
  is the owner's next check.

## [0.7.0] - 2026-11-18

- The agentic store's MCP server serves two MCP Apps widgets (ADR-017): a product carousel for
  `search_catalog` and `get_product`, and a bag for the cart and checkout tools, drawn inside
  ChatGPT or another MCP Apps host. The shopper picks "By hand", where the widget asks the host to
  run the UCP tools up to a payment with a card saved in the account, or "With the assistant",
  where the same buttons only send the assistant a sentence. The widget holds no token or card
  data, loads nothing but the store's images, and over the budget offers the store's own pages.
  `complete_checkout` is marked destructive and open-world, the cancel tools destructive. The Docs
  gain a "ChatGPT app" page with the setup and a download of `atelier-velune-plugin.zip`
  (`plugin.json`, `mcp.json`, a skill, two icons).
- From the widgets' review: an add from the carousel extends the open checkout the bag shows
  instead of starting a second cart; a payment keeps its key only for the same checkout and card;
  the search runs from its button and Enter, since a host frame without `allow-forms` drops a
  form's submit; every control is at least 44 px; the plugin ZIP never takes a hidden file such
  as `.DS_Store`.
- From CI's Semgrep scan: the widget sends to the host's origin once the host has answered, and to
  `"*"` only for the handshake or a host frame with an opaque origin (covered by `bridge.test.ts`,
  with the intentional residual `"*"` documented under an inline `nosemgrep` comment).
- Record the v0.6.0 deploy check: on Render the agentic store serves the Docs and their diagrams,
  the short `/agents` page and the tabbed Back Office, whose JSON pages its log and masks every
  email; `/mcp` still refuses a call without a token. An agent's consent and saved-card payment
  there are the owner's next test.

## [0.6.0] - 2026-11-18

- From the release review: the Back Office masks every email shape the store accepts (a non-ASCII
  name or a numeric top-level domain too), in values and in a detail's keys, and an agent's own
  name; the Log filters by a masked actor and by the `ucp-rest` channel the UCP Docs link to; on
  the consent page Enter in the budget field allows rather than denies; the diagrams run their
  220 ms motion only when reduced motion is off.
- Record the v0.5.3 deploy check: the agentic store on Render serves the account step-up route
  (401 signed out), documents `manage_url` on `/agents` and in its OpenAPI example, and still
  refuses `/mcp` without a token. Raising a limit was not exercised there: on localhost the
  password raise was checked in a browser, the passkey confirmation only in the tests.
- The agentic store's copy is plainer: the home page explains the four steps (find, ask, shop, pay)
  without protocol names and links to the Docs; the order page no longer says an agent paid with
  your saved card when it paid with its own; checkout says why it cannot be paid and what a refusal
  was; the privacy notes say each account has its own data and that the Back Office masks emails.
- The agentic store's v0.5.3 review findings: a spend limit posted as anything but a number is
  stored as no budget, `complete_checkout` answers its status and `agent_budget` from the grant as it
  stands at the end of the request, and raising a limit from a stale account page opens the password
  or passkey form instead of an error.
- The agentic store's consent screen reads like a store's: the agent's name and initial, the
  account with its email masked, one warning line, each permission in words with a "Read only",
  "Can be undone" or "Can't be undone" pill and a "Personal data" mark, a budget with presets
  (EUR 50, 150, 300, 1000) or any amount, and Deny or Allow; the agent's host and where the browser
  returns sit under Details. The device code page uses the same style.
- The header shows "Sign in", or the customer's initial opening Orders, Agents, Payment methods,
  Security and Sign out (also in the phone menu), and links to the new Docs. The account page has
  a section bar, an overview (agents, budget left, saved cards, last order), each agent's budget as
  a meter and orders in pages of 10.
- The agentic Back Office has tabs (Overview, Orders, Payments, Agents, Log, Webhooks) instead of
  one long page: lists come in pages of 25 with a numbered pager, the log also in 50 or 100 and
  filtered by channel, actor, status class, path or reference, each entry opens its redacted JSON
  with a copy button, and an order opens its timeline. Every email in it, and in
  `GET /api/back-office`, is masked; that answer's `trace` is now one page, with `page`, `per`,
  `trace_total` and `trace_pages`.
- New Docs on the agentic store (`/docs`): one whole purchase, then Poppy (PAP 1.0), MCP, WebMCP,
  UCP and the Adyen calls, each as a sequence diagram you step through or play, with the same
  steps as text, a "Try it" panel for the public documents and the `/mcp` challenge, and links to
  the Back Office log of that channel. `/agents` became a short "Connect your AI agent" page; the
  UCP handlers' `spec` links now point to `/docs/ucp`.

## [0.5.3] - 2026-11-18

- An agent over its spend limit on the agentic store now learns where the shopper changes it: the
  `spend_limit_exceeded` message and every signed-in checkout's `agent_budget` give `manage_url`,
  the account page opened at that agent, and `agent_budget` also shows what remains, read after
  the payment it answers. The account page shows each agent's remaining budget, caps a limit at
  EUR 1000 as consent does, refuses a change to a disconnected agent, and asks for the password or
  a passkey again before a limit goes up (lowering it or disconnecting does not ask); adding a
  passkey asks too, since a passkey can confirm a raise. Sign-in now returns to the `#agent-…` the
  shopper was sent to. ChatGPT reported the gap on 2026-11-18.
- Record the v0.5.2 deploy check: ChatGPT's MCP connector signed in to the agentic store on
  Render, sending the token endpoint as its assertion's `aud`, and bought an item with a network
  token, Authorised on Adyen TEST with its webhook. ADR-016 records this outcome and now says that
  a client whose metadata document declares `none` is a public client, which sends no assertion.

## [0.5.2] - 2026-11-18

- The agentic store accepts a client assertion whose `aud` is the issuer, the issuer with a final
  slash or its token endpoint URL, so ChatGPT's MCP connector can get its token; PAP 1.0 allows
  only the issuer, and the owner chose this departure (ADR-016). An array is still refused, and a
  refusal now names the `aud` it received.
- Record the v0.5.1 deploy check: the agentic store advertises the six client assertion
  algorithms on Render; ChatGPT's connector has yet to sign in again.

## [0.5.1] - 2026-11-18

- The agentic store accepts a client assertion signed with ES256, ES384, PS256, PS384, RS256 or
  EdDSA and says so in its OAuth metadata, so an MCP client known by its client metadata document,
  ChatGPT's among them, gets its token; a Session's delegation still takes only ES256 or PS384.
- The known limits and the agentic README describe the store as v0.4.0 made it: shopper accounts
  instead of one demo shopper, agents paying with a saved card, a network token or the shopper at
  `continue_url`, and the Render disk in use only since `DATABASE_PATH` was set.
- Record the v0.5.0 deploy check: the agentic store serves the tasks endpoint and the new MCP
  refusals on Render, and a checkout written before the deploy still answers after it, which
  closes the disk check.

## [0.5.0] - 2026-11-18

- An agentic refresh token keeps every scope and resource of its grant: a token request that
  narrowed one access token (a code exchanged for the MCP URL, a refresh asking for one scope) no
  longer narrowed every later token, as PAP 1.0 §4.5 and RFC 6749 §6 require.
- The agentic store connects to an agent-given URL (client document, `jwks_uri`, platform
  profile) only when its host resolves to public addresses (PAP 1.0 §3); a client document that
  cannot be fetched or read is `invalid_client` instead of a server error, the client's keys are
  cached 5 minutes (an unknown key id refetches them at most once a minute), and `/oauth/token`
  and `/oauth/revoke` share the agents' limit per address.
- Agentic MCP refuses like UCP REST: a missing scope is HTTP 403 and a missing sign-in 401, each
  with the REST `WWW-Authenticate` challenge and a JSON-RPC error `-32000` naming the code, where
  they were a successful tool result; a 429 carries `data.retry_after`. `invalid_session` is a UCP
  error body on REST and a JSON-RPC error on MCP (PAP's UCP extension §9); `version_unsupported`
  keeps PAP's JSON body.
- A PAP agent signed out reaches agentic `/mcp` with a verified Session and shops as a guest, as
  it already could over UCP REST; a client with neither a token nor a Session keeps the 401.
- The agentic store lists `tasks.endpoint` in `poppy.json` (PAP 1.0 §9): `GET /poppy/tasks`
  names the tasks agents cannot do here (account creation, card saving and spend limits are the
  shopper's, on the website; a plain card number has the network token or the shopper as its
  alternative; returns and refunds exist nowhere), and `POST /poppy/feedback` takes a report,
  answers 202 and records it in the trace, attributed only after a verified Session.
- Smaller PAP fixes on the agentic store: scope descriptions for agents say what works without
  the scope, the MCP description and instructions name the three ways to pay, CORS allows
  `Poppy-Extensions`, the consent page tells the shopper to continue only if they just asked this
  agent, the trace names the verified Session's client, and `scripts/pap-agent.ts` checks
  `organization.domain` and `protected_resources` and names `resource` only at the token request.
- Revoking a live agentic refresh token signs the agent out: its grant ends, every token of that
  sign-in stops and the account shows the agent disconnected (PAP 1.0 §4.6, RFC 7009 §2.1).
- An agent's loopback redirect URI matches with any port, for any client (RFC 8252 §7.3).
- A Session JWT's `jti` is remembered until its `iat` can no longer pass, so one sent with an
  `iat` ahead of the clock cannot be replayed.
- Record that agentic data now lives on the Render disk: `DATABASE_PATH` was unset, so the store
  wrote to the image's own folder; with it set, a checkout survives a restart of the service.
- Record the v0.4.0 deploy check: the agentic store serves the account pages and the reworked
  `network_token` handler on Render; the open tasks are now the owner's real passkey check and the
  agentic disk, which accounts and grants now depend on too.

## [0.4.0] - 2026-11-18

- The agentic store keeps idempotent answers per agent client and account: one agent client
  acting for two accounts could otherwise get one account's checkout replayed to the other under
  the same Idempotency-Key.
- An agent pays the agentic store with a network token's number and expiry only: the store reads
  the brand from Adyen `/cardDetails` and pays `networkToken` with ContAuth and
  UnscheduledCardOnFile (no cryptogram, CVC or brand from the agent); completing with no
  instrument hands the checkout to the shopper at `continue_url`. Sign-in returns only to a path
  of the site (tabs, newlines, backslashes and dot segments that resolve to `//` refused), a
  burst of sign-ins meets the failure limit, agents never reach a shopper's checkout made before
  channels existed, the account page lists every grant of the account (not only among the newest
  200), an instrument naming nothing is a 400, and the idempotency record binds a payment
  credential only through a keyed hash.
- The agentic store has customer accounts: sign-up and sign-in with an argon2id password or a
  passkey (`@simplewebauthn` 14), a 7-day HttpOnly session cookie stored as its SHA-256, and
  failed sign-ins limited per address and per account. Consent and device approval need a
  signed-in customer and bind the grant to that account; agents see only that account's cards,
  checkouts and orders, and grants made before accounts stop working. Every checkout, payment and
  order records its `web` or `agent` channel (Back Office filter); UCP and MCP never reach a web
  checkout. An agent, guest or signed in, may pay with its own one-time network token
  (`network_token` handler, paid on Adyen as `networkToken`), never stored, traced or echoed;
  a signed-in agent's payment counts against its limit. Drop-in and card-save sessions are limited
  to 20 a minute per address.
- Record the v0.3.4 deploy check: the weak ETag now revalidates to 304 on Render, but the marker
  checkout created after the disk was added did not survive the deploy, so the agentic disk is
  still not in effect.
- ADR-015 and the agentic store's spec set the next version: customer accounts (email and
  password, passkeys), `web` and `agent` channels on every checkout and order, agent grants bound
  to the account that approved them, and a one-time network token an agent brings, paid on Adyen
  as `networkToken` and never stored.

## [0.3.4] - 2026-11-17

- Record the v0.3.3 deploy check in the digital status: caching headers, negotiation refusals and
  a PAP order through ngrok pass on Render (a weak ETag still gets 200 there, not 304), but an
  order placed on v0.3.2 did not survive the deploy: the agentic disk was not in effect then.
- The agentic store's published artifacts revalidate to 304 when `If-None-Match` carries the
  weak form `W/"…"` of their ETag, as RFC 9110's weak comparison requires. On Render the edge
  weakens the ETag, so a client echoing it always got the full 200 answer.

## [0.3.3] - 2026-11-17

- Review fixes on the agentic store: a cached UCP platform profile keeps only its version and the
  capabilities it shares with the store, so 1,000 padded 256 KiB profiles no longer hold hundreds
  of MB; a client assertion whose `iat` is more than 60 s ahead is refused, so one signed today
  cannot be used much later; `get_product`'s description and the spec now say `preferences` is a
  priority order whose last option is dropped first, as UCP and the code do. The spec lists
  `invalid_pagination`.
- A tech-watch package compares the UCP draft of 2026-11-16 with 2026-08-25 for the agentic store:
  one gap already fixed (cart contents win), three items left open for the next version cut.
- A UCP checkout created from a `cart_id` now takes the cart's lines and buyer, ignoring the
  request's overlapping `line_items` and `buyer`, as the 2026-08-25 cart extension requires; before,
  `line_items` sent next to `cart_id` replaced the cart. Found while reading the UCP draft.
- The store's five WebMCP tools declare an `outputSchema` listing every answer they give, refusals
  included, as the draft lets an agent reject an answer that does not validate. The tests check
  every answer they produce against its tool's schema.
- The agentic store applies RFC 8707 resource indicators: `resource` on authorize, device
  authorization and token requests must be the store's origin (UCP REST) or its `/mcp` URL,
  otherwise `invalid_target` and no code or token; the token endpoint may only narrow to granted
  resources. A token issued for one resource is refused (401) at the other, a token issued without
  one still works at both, and a refresh keeps its resource. `scripts/pap-agent.ts` asks for the
  MCP URL.
- The agentic store resolves and negotiates the `UCP-Agent` platform profile (UCP 2026-08-25): a
  REST call must name an https profile (`invalid_profile_url` 400 otherwise), fetched without
  redirects within 5 s and 256 KiB (`profile_unreachable` 424), shape-checked with public keys
  only (`profile_malformed` 422), on version 2026-08-25 (`version_unsupported` 422) and cached for
  its `max-age` (1 h at most). Capabilities intersect by name and common version, with the schema
  host bound to the name's namespace; an operation outside the intersection gets a 200
  `capabilities_incompatible` body. On MCP, `meta["ucp-agent"]` is optional, a failure is
  JSON-RPC `-32001` with the UCP code, and a header naming another profile is refused. The fetch
  runs after the rate limit and token check, and a refusal is never stored under an
  Idempotency-Key. The OpenAPI description lists 400, 422 and 424; KNOWN_LIMITS says what this
  means for a `curl`.
- The agentic store serves its UCP published artifacts (`/.well-known/ucp`, the OpenAPI
  description and the saved-card handler schema) with `Cache-Control: public, max-age=300` and an
  `ETag` that revalidates to 304, as UCP requires; they were `no-store`. Per-request answers stay
  `no-store`.
- UCP 2026-08-25 catalogue and order answers follow the prose as well as the schemas: products
  and variants carry `description: {plain}`; search pages 10 at a time (50 at most) with an opaque
  cursor and `pagination`; lookup dedupes ids, refuses more than 50 (`request_too_large`, MCP
  `-32602`), returns only the variants an id resolved to with their `inputs` (`exact` or
  `featured`) and lists unknown ids as `info` messages; product puts a requested variant first,
  returns `selected` (relaxed by `preferences`) and option values with `available` and `exists`,
  and answers an unknown id with a 200 error body. Filters apply to all three. Orders carry
  `fulfillment` and per-line `quantity` and `status`. Captured answers validate with ucp-schema.
- PAP 1.0 checks on the agentic store follow the text exactly: the Session's delegation is read
  from the JWT header's `poppy_dlg` (§5.2), its `aud` must be the issuer as one string, an expired
  delegation is `invalid_session`, and a Session needs `Poppy-Version` 1.x (1.1 accepted, a
  missing or malformed one refused). A client assertion's `aud` must be the issuer as one string,
  `iat` is required and it may live 300 s at most. The test agent and `scripts/pap-agent.ts` send
  Sessions the same way.
- Specify the agentic store's v0.3.3 conformance fixes before the code: UCP-Agent profile
  resolution and negotiation, RFC 8707 resource binding, the PAP Session and client assertion
  checks, UCP catalogue paging, lookup, product and order shapes, published-artifact caching and
  WebMCP output schemas.

## [0.3.2] - 2026-11-17

- The agentic store keeps its data across deploys: its Render service moves to `starter` with a
  1 GB disk at `/var/data` and `DATABASE_PATH=/var/data/agentic.sqlite`, like Digital and styling.
  Before, every deploy or restart emptied its orders, agents and grants. ADR-003, the Render
  runbook, the owner's preferences, the store's doc and `docs/KNOWN_LIMITS.md` say so; only
  Digital and styling still have their own `render.yaml`.
- Record the v0.3.1 deploy check in the digital status: on Render one client is limited whatever
  first `X-Forwarded-For` entry it forges (the 121st `/api/health` on digital and styling, the
  241st `/mcp` on agentic), and Cloudflare refuses a caller-written `CF-Connecting-IP`.
  `work/current.md` keeps a two-client check for the owner.

## [0.3.1] - 2026-11-17

- Every per-address limit trusts the address the platform writes, not the caller: the agentic
  store's `clientIp` and `packages/platform`'s new `clientAddress` (the rate limit, `shopperIp`)
  take `CF-Connecting-IP`, which Cloudflare in front of Render writes over any caller copy, then
  the last `X-Forwarded-For` entry, never the first one the caller writes, and ignore a value that
  is not an address. A forged first entry no longer escapes the 240-a-minute limit, spreads wrong
  user codes, or gets a victim's address a 429; Digital and styling's limiter and `shopperIP`
  follow the same rule. Local runs keep one client per socket address (Next.js) or `local`.
- Record the v0.3.0 deploy check (Next.js 16.4.6 served, Sessions Drop-in on the public origin,
  the agentic store's new endpoints) in the digital status, close the agentic interoperability
  task in `work/current.md` and move its optional WebMCP token step to the Render clean-up entry.

## [0.3.0] - 2026-11-17

- Agentic store, from the release reviews: starting a device sign-in shares the agents' limit of
  240 requests a minute per address. Since a caller can vary `X-Forwarded-For`, the store also
  holds at most 1,000 device requests (then `temporarily_unavailable`), each deleted one lifetime
  after it expires, and the limiter tracks at most 10,000 addresses. Looping
  `/oauth/device_authorization` can now hold up new device sign-ins for up to 20 minutes, but no
  longer grows the store or the limiter's memory.
- Agentic store, PAP 1.0 §4.7: a sign-in request from a PAP agent (a URL `client_id` that signs
  with `private_key_jwt`) must carry `scope`, on the authorization code and the device grant, or
  it gets `invalid_scope`; any other MCP client that sends none, registered or a public URL client,
  is still offered the cart, checkout and pay scopes. `/agents` and the spec say so; the
  conformance matrix has the rule.
- `work/current.md`: the agentic interoperability task waits for the owner's visual check and the
  PAP §4.7 decision once it is on develop.
- From the second review pass: each agentic test starts with no wrong-code record, so the device
  tests pass in any order; the Digital test of a payment outside an Adyen order sends another
  amount than the order's; `/agents` says a URL client signs its device requests.
- Agentic store, from the pre-push review: the phone menu closes when a link in it opens another
  page (the root layout kept it open over the new page).
- Agentic store, from the pre-push security review: the device sign-in refuses a client whose
  `client_id` is a URL unless it signs its requests, since without a callback on that host anyone
  could start a public one's sign-in and be shown as it; the wrong-code record forgets addresses
  with no recent miss and keeps at most 1,000. `src/proxy.test.ts` checks Basic Auth and the
  cross-site refusal through the proxy itself.
- Digital Checkout: a payment into an Adyen order (gift card, then card) again asks Adyen for its
  own share, not the whole order; the metadata change had made the request builder send the order's
  total. `api.test.ts` pins both cases.
- Move the three apps to Next.js 16.4.6. 16.4.5 fixes GHSA-mfr8-8qww-v76h and six other moderate
  advisories (`use cache` leaks, forwarded-response injection, image SVG check, Edge cookie
  header), so `next build` no longer stops on Next's security guard; 16.4.6 also compresses route
  handler responses, checked on `/mcp`, the UCP documents and a scripted agent purchase on TEST.
  Only `next`, `@next/env` and the `@next/swc-*` binaries change in `bun.lock`.
- Record the 2026-11-16 checks of the agentic store in its spec (184 tests, builds, the browser
  WebMCP check, a scripted agent purchase on TEST) and the open push in `work/current.md`.
- Agentic `/agents` page: what an MCP host needs (remote MCP, OAuth discovery from the 401, a
  reachable callback or the device sign-in), generic MCP clients next to PAP agents, the device
  sign-in steps, the scopes with their PAP hints from the server's own table, and the WebMCP
  tools; the home page and the app README follow.
- Agentic store is WebMCP ready: in a browser that exposes `document.modelContext`, the shopping
  pages register `search_catalog`, `view_cart`, `add_to_cart`, `update_cart_item` and
  `start_checkout`, which use the same cart and checkout calls as the buttons and a new read-only
  `GET /api/catalog`; no tool pays, and the account, consent, device and Back Office pages
  register none. An optional `WEBMCP_ORIGIN_TRIAL_TOKEN` is sent as `Origin-Trial` on pages. The
  `/mcp` server is unchanged. The cart keeps working in memory where localStorage is blocked, and
  `scripts/pap-agent.ts` exits when its run ends instead of five minutes later.
- Agentic account page: each agent reads consent given, access issued, connected (first and last
  request, UTC) or disconnected, so a consent alone no longer looks connected; its permissions
  are listed in the consent page's words instead of scope names.
- Agentic store, from the Atelier Velune interoperability report: `poppy.json` gives
  `auth.scopes` as a scope-to-description map and `auth.scope_hints` keyed by scope with both PAP
  hints; scopes are offered under their UCP names (`dev.ucp.shopping.cart:manage`,
  `…checkout:manage`, `…order:read`), the old `ucp:checkout` and `ucp:orders` still honoured;
  `/.well-known/ucp` lists `dev.ucp.common.identity_linking` with the order read as its one hard
  gate; REST answers UCP's `identity_required` 401 and `insufficient_scope` 403 with a Bearer
  challenge carrying the issuer as realm, and neither is kept under an Idempotency-Key; an agent
  reads only the orders it placed; search reads UCP's `categories` and `price.min`; the OpenAPI
  names UCP's operationIds and schemas, and declares each operation's token rule, scope, statuses
  and examples; the OAuth device grant (RFC 8628) with a `/device` page for agents that cannot
  receive a browser callback. New `device`, `identity` and `openapi` test files check the
  document against the server's answers.
- Digital Checkout (from Gemini): `/sessions`, Advanced `/payments` and `/api-only` send a fixed
  two-key `metadata` (`playground`, `flow`), and `/sessions` no longer puts recipient names in
  `deliveryAddress`; the request builders are exported and pinned by `api.test.ts`.
- Interface pass across the three apps (from Gemini): touch targets of at least 44 px, a skip
  link and a phone menu on the agentic store, dark text on the green buttons for AA contrast
  (`--color-on-green`), no text under 11 px, balanced headings and readable line lengths, the
  eyebrow labels dropped, and shorter hint copy.
- Protect `main` on GitHub (pull request, the five CI checks up to date, resolved conversations,
  administrators included, no force-push or deletion) and delete the three merged `task/*`
  branches; the protection runbook records the read-back.
- Record the v0.2.0 deploy check (Next.js build served, Sessions Drop-in on the public origin)
  in the digital status, and the Render clean-up left to the owner in `work/current.md`.

## [0.2.0] - 2026-11-15

- Pass CI's scans: `bunfig.toml` sets `minimumReleaseAge` to one week, Biome is pinned to 2.6.6
  (2.6.7 was four days old), and `.gitleaksignore` names the agentic test preload's fake HMAC key.
- Agentic store, from the release review: the grant's budget is reserved when a checkout is
  claimed, so completes on several checkouts at once cannot pass the spend limit, and each
  payment's reservation is settled once whichever of the answer or the webhook arrives first, and
  a webhook that settles a payment during the call is never undone or doubled by its answer; an
  order is placed from the lines its payment was priced from and only when Adyen's amount matches;
  payments are found by reference, not in the newest 200 rows; a late refusal of an older
  attempt no longer reopens a pending checkout; the proxy refuses cross-site writes on the
  shopper paths (the consent decision could be forged); every response carries the security
  headers. Digital and styling turn React Strict Mode off, which called Adyen twice per mount
  in dev. `verify` stops the servers that started when another fails.
- Gate `bun run check` on Biome (`biome:ci`; `fmt` and `lint` scripts). Its 44 lint errors are
  fixed (typed `let`s, lazy initialisers as statements, a renamed `escape`, a test that asserts
  the webhook exists, decorative SVGs hidden, the checkout skeleton a `status`) or justified with
  `biome-ignore` where the code is deliberate (effect triggers, a constant theme script).
- Format the code with Biome 2.6.6 (`biome.json`: spaces, indent 2, line width 100, double
  quotes, semicolons; Markdown left out because Biome's Markdown formatter rewrites YAML
  frontmatter). Formatting only: no behaviour changes.
- Record that `main` has no branch protection and no ruleset (read back 2026-11-15), so the
  checks in the GitHub protection runbook are a procedure until an administrator applies them;
  the OKF reference names the Bun checker and the 120-line `AGENTS.md` cap.
- Finish the move off Deno: `deno.json`, `deno.lock`, the Vite plugins and the Fresh start script
  are gone. The knowledge checker, `dev:all`/`start:all` (`tools/dev/run-all.ts`), `verify`, the
  SSR assertion (now on each standalone server) and the legacy env migration run on Bun;
  `bun run check` is the gate and CI's "Deno check" job is now "Bun check". All three images build
  in the Bun workspace with the SSR assertion and run as uid 1993 (user `app`). Turbopack no longer
  watches the SQLite files, which made the dev Sessions page re-create sessions in a loop. The
  agentic proxy strips `--env-file` quotes from the Basic Auth pair. ADR-014 supersedes ADR-004 and
  ADR-006.
- Move `apps/adyen-digital` to Next.js 16 on Bun: pages under `src/app`, one Elysia API in
  `src/server/api.ts` behind `/api/*`, `/healthz` and `/webhook` route handlers, every browser call
  on Eden, the checkout workbench rendered client-only. The proxy sets Basic Auth and the CSRF
  cookie without reading config, so no `.env` or database is traced into the standalone build.
  `ensureCsrfToken` is split out of `ensureSession`; the ephemeral signing secret is shared per
  process; Eden keeps dates as strings. Tooling, Docker and CI are still on Deno.
- Start the move off Deno and Fresh: one Bun workspace (`package.json`, `bunfig.toml`, one root
  `bun.lock`); `packages/platform` on `bun:sqlite`, `process.env` and an Elysia base API with the
  same basic auth, rate limit, CSRF, session and security headers; `packages/ui` on React 19 with
  an Eden client; `apps/adyen-v6-styling` rebuilt as a Next.js 16 app on Bun with a standalone
  image. The platform and styling tests run under `bun test`. Digital is still on Fresh until its
  port, so the Deno checks are red in between.
- Bring the bounded-intake and specs-first policies to their v4.0.3 text, so they describe the
  updated path and bash guards and the doc-links checker.
- Remove the IPP Endless Aisle app, its `ipp-endless-aisle` Render service, its landing card, dev
  tasks and docs, at the owner's request; the other apps keep ports 8001, 8003 and 8004.
- Update to Æion Template v4.0.3 with `template-update` (from Æion Factory v1.7.0): doc gate in
  `enforce`, 340k/390k context rule, `tools/template-tests`, framework mode off. Graphify, Archify,
  their CI workflow and receipt, the `graph` skill and `efficiency/` are removed (ADR-013).
- `deno task types` names the three Deno apps instead of `apps/**`, whose glob now reached the Bun
  store's `node_modules` and overflowed the argument list; the store keeps its own `tsc` check.
- Rebuild `apps/adyen-agentic-commerce` as one Next.js 16 app on the Bun runtime (Elysia in the
  route handlers, Eden client, `bun:sqlite`): the Atelier Velune demo store over UCP 2026-08-25
  (REST and MCP) behind PAP 1.0 sign-in, a human Drop-in checkout, a zero-value card save and agent
  payments on the saved card (ContAuth), all on Adyen TEST; 107 `bun test` cases cover the PAP
  merchant MUSTs, OAuth, UCP idempotency and the payment state machine; a checkout or a Drop-in
  session completed twice at once now pays and orders once; an expired delegation ends the session.
  Its Docker image builds on `oven/bun` with Next's standalone server, and `dev:all`, `start:all`,
  `verify` and the env migration run it through `tools/dev/bun-app.ts`.
- Move every app to Adyen Web 6.48.1 and `@adyen/api-library` 32.3.0 with a minimal lockfile change
  (Preact stays 10.29.8, `adyen.css` tokens unchanged); assert the JSON body type in the transport
  test now that the library's transport also accepts a Buffer.
- Run the four containers as the image's `deno` user (uid 1993) after a shared entrypoint chowns the
  Render disk and `/app/data`; document the measured `root:1000` disk ownership.
- Adopt the Æion Factory v1.7.0 repository and agent architecture in a nine-folder layout; keep the
  root `render.yaml`, the four apps, TEST-only rules and Adyen versions unchanged.
- Move the development and build scripts from `scripts/` to `tools/dev/`, `tools/build/` and
  `tools/knowledge/`; update the root tasks, every app's Vite configuration, the Dockerfiles and the
  knowledge sources.
- Add eight-section component specs for every app and shared package, with `Spec:` pointers in both
  directions and the factory policy set (engineering, security, specs, layout, UI, intake, owner).
- Import the 16 maintained skills and the Claude/Pi/dsh/Codex/OpenCode/Devin/Droid adapters, the
  250k/300k context checkpoint and the git hooks.
- Pin Graphify 0.9.97 and Archify v3.2.0 under the ignored `.aeion/`, replace the factory views with
  the project's architecture, delivery and payment-lifecycle diagrams, and add the exact-commit CI
  refresh.
- Add CI, the reviewed `develop → main` release flow and the optional (off) PR-review and outer-loop
  workflows.
- Split `FlowWorkbench` and `StylingPlayground` below the 1,500-line cap, trim three comment blocks,
  regenerate the efficiency bundle and restore a green `deno task check`.

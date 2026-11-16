# Changelog

Every notable change, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[SemVer](https://semver.org/)).

## [Unreleased]

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

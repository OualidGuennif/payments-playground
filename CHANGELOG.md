# Changelog

Every notable change, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[SemVer](https://semver.org/)).

## [Unreleased]

- Format the code with Biome 2.6.7 (`biome.json`: spaces, indent 2, line width 100, double
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
  ADR-006; no formatter or linter runs until the owner picks one.
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

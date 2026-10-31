---
type: Policy
title: "The owner's preferences"
description: "Durable project preferences: Render at the root, TEST only, the factory scope, the toolchain and the pi worker model."
status: stable
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31T19:05:00Z
sources:
  - resource: ../../AGENTS.md
    title: "Project rules and owner"
  - resource: ../../render.yaml
    title: "Root deployment blueprint"
  - resource: ../../efficiency/00-EFFICIENCY.md
    title: "The adoption guide"
---

# The owner's preferences

What the owner asked for that a reviewer should not have to ask again.

## Delivery

- `render.yaml` stays at the repository root; the five services, Docker contexts, health checks and
  Render auto-deploy from `main` are not moved.
- Work reaches `main` through `develop` and a reviewed release pull request. `main` is the deploy
  branch.
- Git is enabled: `tools/git-hooks` pre-commit and pre-push, with review receipts in
  `.aeion/reviews`.
- The factory starts at `VERSION` 0.1.0; the first release is tagged `v0.1.0`.

## Scope

- The 525-folder passive skill pool and the `demo/` playground are deliberately omitted. The 16
  maintained procedures live in `.claude/skills`.
- At most nine top-level folders, named by role; `tools/` is the one home for scripts and checks.
- TEST only; never add a LIVE path. Adyen Web 6.47.0 and Checkout API v72 stay pinned.
- Existing public docs (`README.md`, `docs/SECURITY.md`, `docs/KNOWN_LIMITS.md`) win over factory
  defaults where they differ; record the divergence here.

## Toolchain

- Deno 2.9.4, Python 3.12+ (excluding 3.14.1) and Node 18+.
- Graphify 0.9.97 and Archify v3.2.0 are pinned in `tools/architecture/integrations.json`.
- Graphify/Archify are enabled: setup installs only into `.aeion/integrations`; refresh runs on
  `main` and on pull requests.
- Pi workers use `opencode-go/deepseek-v4.1-flash`, headless, `--thinking max`, one scoped brief per
  worker.
- Docker images start as root only for `tools/docker/entrypoint.sh` to chown the Render disk and
  `/app/data` to uid 1993, then drop to the `deno` user; the missing-user SAST rules stay waived
  inline in the four Dockerfiles (2026-10-31, measured disk `root:1000`).

## Workflow

- Plan first; wait for the owner's yes.
- Keep reasoning private; speak only for a decision or a concise result.
- Report the verification level actually reached; never claim a browser, webhook or deploy check
  that was not run.

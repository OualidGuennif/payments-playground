---
type: Runbook
title: "Docker images and the Render deployment"
description: "Building and running an image locally, what the context excludes, the root chown that drops to the app user, and how the Render Blueprint deploys the landing page and three services."
tags: [runbook, docker, render, deploy]
status: stable
scope: docker-and-render
generated:
  by: claude-code/opus-5.5
  at: 2026-11-26T08:18:00Z
sources:
  - id: dockerfile
    resource: ../../apps/adyen-digital/Dockerfile
    title: "Digital image: built in the Bun workspace, Next standalone server"
  - id: agentic-dockerfile
    resource: ../../apps/adyen-agentic-commerce/Dockerfile
    title: "Agentic image: built in the Bun workspace, tests in the build stage, Next standalone server"
  - id: styling-dockerfile
    resource: ../../apps/adyen-v6-styling/Dockerfile
    title: "Styling image: built in the Bun workspace, Next standalone server"
  - id: entrypoint
    resource: ../../tools/docker/entrypoint.sh
    title: Root chown, then drop to the app user (uid 1993)
  - id: dockerignore
    resource: ../../.dockerignore
    title: Build context exclusions
  - id: render
    resource: ../../render.yaml
    title: Blueprint for the landing page and the three services
verified:
  - at: 2026-10-31
    check: "All four images built; a root:root 644 volume became 1993:1993 and the digital, IPP and agentic apps answered /healthz as uid 1993; styling wrote its disk; Render measured /var/data root:1000 2775 and the SQLite files 644."
  - at: 2026-11-15
    check: "All three Bun workspace images built with the SSR assertion in the build stage; each ran as uid 1993 with /healthz 200; digital served six pages and its CSS, wrote /app/data, reported healthy; agentic six pages; no env file in the app folders."
---

# Docker images and the Render deployment

## Locally

```bash
docker build -f apps/adyen-digital/Dockerfile -t digital-checkout:test .
docker run --rm --env-file apps/adyen-digital/.env -p 8000:8000 digital-checkout:test
```

The context is the repository root. `.dockerignore` keeps every `.env`, `.env.local`, `data/`,
SQLite file, `.next`, `node_modules` and `.git` out of it
([ADR-009](../decisions/ADR-009-no-secrets-in-images.md)): credentials only ever reach a container
as environment variables. `--env-file` keeps quotes around values; the app strips them.

Every image builds inside the Bun workspace on `oven/bun:1.4.4`: it copies the root manifests and
every member's `package.json`, runs `bun install --frozen-lockfile`, copies `packages`, `testing`,
`tools/build` and the app, type-checks and builds it (the agentic store also runs `bun test`), then
boots the standalone server once for the SSR assertion. The runtime stage keeps only
`.next/standalone` and `.next/static`, runs `bun apps/<app>/server.js` on `PORT` (8000) with
`HOSTNAME=0.0.0.0` and `__NEXT_PROCESSED_ENV=true`, and has a `HEALTHCHECK` on `/healthz`. Next
copies a loaded local `.env` into `.next/standalone` by design; an image never gets one because the
context excludes it. Inside it, the database is
`/app/data/digital.sqlite` unless `DATABASE_PATH` says otherwise; without a volume it is lost when
the container stops.

The image starts as root only in `tools/docker/entrypoint.sh`: it chowns `/var/data` (the Render
disk) and `/app/data` to uid 1993, then `exec setpriv ...` drops to the image's `app` user before
the app starts. A plain `USER app` would fail because Render mounts `/var/data` as `root:1000` with
`644` SQLite files.

## Render

`render.yaml` is one Blueprint: a static site for `apps/landing`, and the three Docker services,
each on `starter` with a 1 GB disk at `/var/data` holding its SQLite file (`agentic-commerce` was on
`free` without one until 2026-11-17, so every deploy or restart emptied its store). Adding a disk
ends zero-downtime deploys: each deploy stops the old instance before the new one starts. The
`ipp-endless-aisle` service left the Blueprint on 2026-11-15 with its app; Render keeps a service
removed from a Blueprint until it is deleted in the dashboard. Digital and styling also have their
own `render.yaml` for an isolated deploy. Render builds from this repository's Dockerfiles; no image
is pushed to a registry.

Per service, set the Adyen TEST values as secret env vars (`sync: false`), let Render generate
`PROFILE_ENCRYPTION_KEY` and `SESSION_SIGNING_SECRET`, and keep `PUBLIC_ORIGIN` equal to the public
URL (it anchors the webhook URL and the CSRF fallback). Add that origin to the client key's allowed
origins and point a TEST webhook at `${PUBLIC_ORIGIN}/webhook`. The agentic store needs no generated
secret; it takes `ADYEN_HMAC_KEY` and the optional basic auth pair, and its webhook path is
`${PUBLIC_ORIGIN}/api/webhooks/adyen`. Its Ask agent reads the model keys `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `MISTRAL_API_KEY` and `DEEPSEEK_API_KEY` and the console's
`CONSOLE_PASSWORD` (16 characters or more) and the voice's `VOICE_MODE_PASSWORD` (any length), all
`sync: false`; without the answer model's key the chat stays off, without the console password
`/console` does not exist, without the voice password voice is not offered. Models, efforts and limits keep the
code's defaults unless an `ASK_*` variable from `.env.example` is set; the console overrides them
and stores its choice in the SQLite file. Flue keeps its own `flue.sqlite` beside it on the disk.

After a push to `main`, confirm what is live with `GET /api/health`: it reports the Adyen Web,
Checkout API and library versions.

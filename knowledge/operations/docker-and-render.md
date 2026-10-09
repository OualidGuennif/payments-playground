---
type: Runbook
title: "Docker images and the Render deployment"
description: "Building and running an image locally, what the build context excludes, how env files are read, and how the Render Blueprint deploys the landing page and four services."
tags: [runbook, docker, render, deploy]
status: stable
scope: docker-and-render
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: dockerfile
    resource: apps/adyen-digital/Dockerfile
    title: Digital image
  - id: dockerignore
    resource: .dockerignore
    title: Build context exclusions
  - id: render
    resource: render.yaml
    title: Blueprint for the landing page and the four services
verified:
  - at: 2026-10-09
    check: "digital-checkout:6.46.0 built from a clean context holds no .env or .sqlite; run with the quoted local .env it reported a configured profile and listed 14 payment methods from TEST; with quoted Basic Auth credentials every page answered 401 without them and 200 with them."
---

# Docker images and the Render deployment

## Locally

```bash
docker build -f apps/adyen-digital/Dockerfile -t digital-checkout:test .
docker run --rm --env-file apps/adyen-digital/.env -p 8000:8000 digital-checkout:test
```

The context is the repository root. `.dockerignore` keeps every `.env`, `.env.local`, `data/`,
SQLite file, `_fresh`, `node_modules` and `.git` out of it
([ADR-009](../decisions/ADR-009-no-secrets-in-images.md)): credentials only ever reach a container
as environment variables. `--env-file` keeps quotes around values; the app strips them.

The image (`denoland/deno:2.9.4`) builds the app, runs its SSR assertion at build time, listens on
`PORT` (8000) and has a `HEALTHCHECK` on `/healthz`. Inside it, the database is
`/app/data/digital.sqlite` unless `DATABASE_PATH` says otherwise; without a volume it is lost when
the container stops.

## Render

`render.yaml` is one Blueprint: a static site for `apps/landing`, and the four Docker services
(`digital-checkout` and `dropin-styling` on `starter` with a disk, `ipp-endless-aisle` and
`agentic-commerce` on `free` without one). Each app also has its own `render.yaml` for an isolated
deploy. Render builds from this repository's Dockerfiles; no image is pushed to a registry.

Per service, set the Adyen TEST values as secret env vars (`sync: false`), let Render generate
`PROFILE_ENCRYPTION_KEY` and `SESSION_SIGNING_SECRET`, and keep `PUBLIC_ORIGIN` equal to the public
URL (it anchors the webhook URL and the CSRF fallback). Add that origin to the client key's allowed
origins and point a TEST webhook at `${PUBLIC_ORIGIN}/webhook`.

After a push to `main`, confirm what is live with `GET /api/health`: it reports the Adyen Web,
Checkout API and library versions.

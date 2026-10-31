---
type: Decision
title: "ADR-009: Secrets and TEST data never enter a Docker image"
description: "A .dockerignore keeps every .env, SQLite file and build output out of the build context; credentials reach containers only as environment variables."
tags: [decision, docker, secrets]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: dockerignore
    resource: ../../.dockerignore
    title: Build context exclusions
  - id: config
    resource: ../../packages/platform/config.ts
    title: unquoteEnvValue
---

# ADR-009: Secrets and TEST data never enter a Docker image

**Context.** There was no `.dockerignore`. `COPY apps ./apps` put all four apps' `.env` files (API,
HMAC and client keys) and their SQLite orders into every image built locally, so a `docker push`
would have published them. Render was never affected: it builds from git.

**Decision.** `.dockerignore` excludes `**/.env`, `**/.env.local`, `**/data`, SQLite files,
`_fresh`, `node_modules` and `.git`. Credentials reach a container through `--env-file` or the
host's environment. Quotes that `docker run --env-file` keeps around `KEY="value"` are stripped at
startup and written back to `Deno.env`.

**Consequences.** An image is safe to push as far as this repo's secrets go. A local `.env` in
dotenv style works unchanged with `docker run --env-file`.

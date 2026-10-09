# Payments Playground

Four self-contained Fresh + Hono apps for exploring Adyen integrations against TEST, sharing one
platform and UI package.

> **TEST ENVIRONMENT ONLY**: never enter production credentials. Every endpoint, variable and
> payment flow here targets Adyen TEST and will not work in production.
>
> **These are playgrounds, proofs of concept and test harnesses. None of them is intended to be
> deployed to production as-is, and none is a reference or certified integration.** See
> [Disclaimer](#disclaimer) before using any of this in your own work.

## Applications

**Only the styling playground is ready to use.** The other three run and are worth exploring, but
they are still being built, treat anything you see there as work in progress, not as a reference
integration.

| App                       | Covers                                                                | Status                     | Dev port |
| ------------------------- | --------------------------------------------------------------------- | -------------------------- | -------: |
| `adyen-v6-styling`        | **Drop-in Styling** · theming options and CSS overrides               | **Ready**                  |     8004 |
| `adyen-digital`           | **Digital Checkout** · Sessions, Advanced, Pay by Link, MIT, API Only | In progress · est. Q3 2026 |     8001 |
| `adyen-ipp-endless-aisle` | **Endless Aisle** · in-person cart and Terminal API Cloud Device      | In progress · est. Q4 2026 |     8002 |
| `adyen-agentic-commerce`  | **Agentic Commerce** · mock and real paths kept distinct              | In progress · est. Q1 2027 |     8003 |

Dates are estimates for the end of the quarter, not commitments.

A fifth entry, `apps/landing/`, is the static front door that links to the four. It is plain HTML
with no build step and no server.

## Getting started

Requires Deno 2.9.4 or later.

```bash
deno task dev:all
```

That starts all four apps on ports 8001–8004 with hot reload; one `Ctrl+C` stops them. To run just
one, use `dev:digital`, `dev:ipp`, `dev:agentic` or `dev:styling`.

Each app reads its credentials from its own `.env`. Copy `apps/<app>/.env.example` to
`apps/<app>/.env` and fill in your TEST values, no `.env` file is committed. The browser only ever
receives the publishable TEST client key; API keys, HMAC keys and bearer tokens stay server-side,
and extra profiles are encrypted at rest.

## Tasks

```bash
deno task check    # fmt, lint, types, tests and all four builds
deno task test     # unit and integration tests
deno task build    # four production builds
deno task verify   # start the builds and check /healthz
```

Per app: `deno task --cwd apps/adyen-digital <dev|build|test|start>`. `start` serves the last
production build, so it needs a `build` first.

## Deployment

Docker images build from the repo root and each has a `HEALTHCHECK` on `/healthz`:

```bash
docker build -f apps/adyen-digital/Dockerfile -t digital-checkout:test .
docker run --rm --env-file apps/adyen-digital/.env -p 8000:8000 digital-checkout:test
```

On Render, the root `render.yaml` describes all four services; each app also has its own for an
isolated deploy. Create a Blueprint from the repo, add TEST credentials in the dashboard, let Render
generate `PROFILE_ENCRYPTION_KEY` and `SESSION_SIGNING_SECRET`, then add the deployed HTTPS origin
to the client key's allowed origins and point your TEST webhook at `/webhook`. Set `PUBLIC_ORIGIN`
if a service name differs from the default.

## Storage

SQLite in WAL mode holds profiles, orders, sessions, attempts, API calls, callbacks, webhooks,
lifecycle actions and the audit log. The schema is `packages/platform/migrations/001_initial.sql`.
Render needs a persistent disk for it. This suits a single instance; several replicas would want the
same model on PostgreSQL plus a webhook queue.

## Versions

| Dependency           | Version | Notes                                             |
| -------------------- | ------- | ------------------------------------------------- |
| Deno                 | 2.9.4   | Shared runtime                                    |
| Fresh                | 2.3.3   | SSR and islands                                   |
| Hono                 | 4.12.31 | API router inside each Fresh server               |
| Vite                 | 7.1.4   | Build and HMR (version linked to Fresh version)   |
| Adyen Web            | 6.46.0  | Client-side components                            |
| `@adyen/api-library` | 32.0.0  | Server-side calls, over its own node:https client |
| Checkout API         | v72     | Explicit TEST endpoints                           |

Server-side Adyen calls go through the library's `HttpURLConnectionClient`. Two details it relies on
were missing from Deno's node:http layer before 2.8.0, so `packages/platform/adyen.ts` works around
both. The pinned runtime no longer needs those workarounds, but they are harmless and keep the suite
runnable on an older local Deno; the comments there explain what and why.

## Disclaimer

**Purpose.** Everything in this repository exists to demonstrate, explore and test Adyen
integrations against the Adyen **TEST** environment. It is written for learning, prototyping and
proofs of concept. It is not a product, not a template to ship, and not a certified or reference
integration, including the parts marked _Ready_, which means "usable as a playground", not
"production-grade".

**Not an Adyen product.** This is an independent personal project. It is not built, reviewed,
endorsed or supported by Adyen, and it is not covered by any Adyen support agreement or SLA. Adyen's
own documentation and Customer Area are the authoritative sources; where this repository and Adyen
disagree, Adyen is right.

**Merchant responsibility.** If you take anything from here into your own systems, you alone are
responsible for the result. That includes, without limitation:

- PCI DSS scope, obligations and validation for your integration
- regulatory compliance, including PSD2/SCA, consumer protection, tax and local payment rules
- security review, penetration testing, secret management, access control and monitoring
- data protection and privacy, including GDPR obligations for any personal data you process
- correctness, availability, reliability and error handling of your own payment flows
- your commercial agreement with Adyen and with every payment method you enable

Nothing here reduces those obligations, and no control in this code should be relied on as a
compliance measure.

**No warranty, no liability.** This project is provided **"as is"**, without warranty of any kind,
under the [MIT Licence](./LICENSE). The authors and contributors accept no liability for any claim,
damage, financial loss, chargeback, outage, regulatory penalty or other consequence arising from its
use, whether in test or in production.

**Never use LIVE credentials.** The code refuses LIVE endpoints and non-`test_` client keys, but
that is a convenience guard, not a guarantee. Pointing any of this at a production account is
entirely at your own risk. See [SECURITY.md](./docs/SECURITY.md) and
[KNOWN_LIMITS.md](./docs/KNOWN_LIMITS.md) for what is and is not covered.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Security and threat model](./docs/SECURITY.md)
- [Known limits and simulated features](./docs/KNOWN_LIMITS.md)
- Built-in wikis at `/wiki` in Digital, IPP and Agentic

Reference material: [Fresh](https://jsr.io/@fresh/core/doc),
[Hono](https://jsr.io/@hono/hono/versions),
[Adyen Web](https://www.npmjs.com/package/%40adyen/adyen-web),
[Node API library](https://www.npmjs.com/package/%40adyen/api-library?activeTab=versions),
[Checkout API v72](https://docs.adyen.com/api-explorer/Checkout/72/post/sessions),
[HMAC](https://docs.adyen.com/development-resources/webhooks/secure-webhooks/verify-hmac-signatures)
and [idempotency](https://docs.adyen.com/development-resources/api-idempotency).

---
type: Component
title: "packages/platform: the server-side library every app shares"
description: "Module by module, what packages/platform owns: the Adyen client, configuration, profiles, storage, security middleware, HMAC, sanitising, the state machine, lifecycle rules and per-market data."
tags: [component, platform, server]
status: stable
scope: component-platform
generated:
  by: claude-code/opus-5.5
  at: 2026-10-15T08:00:00Z
sources:
  - id: platform
    resource: ../../packages/platform
    title: The package
---

# packages/platform

Server only. Never import it from an island, except `markets.ts` (pure data). Each module has its
tests next to it (`*.test.ts`).

| Module                                            | Responsibility                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adyen.ts`                                        | The only path to Adyen. Wraps `@adyen/api-library` 32, refuses non-TEST endpoints, supports query params (unused since `GET /sessions` was dropped), maps library errors to `AdyenRequestError` with the upstream status. Carries two harmless workarounds for Deno < 2.8.                                     |
| `base-api.ts`                                     | `createPlatformContext(appId)`: config, repository, profiles and the Hono app with security headers, Basic Auth, rate limiting and CSRF; shared routes (health, bootstrap, profiles, callbacks, timeline).                                                                                                     |
| `config.ts`                                       | Reads env vars, then `.env` files as fallback; strips quotes Docker leaves on `--env-file` values; derives `PUBLIC_ORIGIN`, the database path and the default profile.                                                                                                                                         |
| `profiles.ts`                                     | Default profile from env; extra profiles encrypted with AES-256-GCM.                                                                                                                                                                                                                                           |
| `storage.ts`, `migrations.ts`, `migrations/`      | SQLite repository ([data model](../architecture/data-model.md)).                                                                                                                                                                                                                                               |
| `security.ts`                                     | Signed session cookie, double-submit CSRF with a same-host Origin check (a refused mutation never issues cookies, so it cannot replace the token a concurrent bootstrap just set), `requestOrigin`, rate limiter (120 requests a minute per client and path), security headers (no CSP), `basicAuthChallenge`. |
| `hmac.ts`                                         | Standard-notification and header HMAC (SHA-256) verification.                                                                                                                                                                                                                                                  |
| `sanitize.ts`                                     | Redacts infrastructure credentials before logging; `rejectRawCardData` refuses PAN/CVC fields.                                                                                                                                                                                                                 |
| `state-machine.ts`                                | `mapAdyenResultCode`, `resolveOrder` ([lifecycle](../architecture/payment-lifecycle.md)).                                                                                                                                                                                                                      |
| `lifecycle.ts`, `payment-methods.ts`              | Per-method capabilities and `actionPermissions`; editable without touching flows.                                                                                                                                                                                                                              |
| `markets.ts`                                      | Country to currency, locale and a presentable amount; zero-decimal currencies. Shared with styling.                                                                                                                                                                                                            |
| `addresses.ts`, `shopper.ts`, `sessionContext.ts` | TEST shopper data per market: addresses, weekly `shopperReference`, line items, risk fields.                                                                                                                                                                                                                   |
| `test-only.ts`                                    | `assertTestOnly`, `profileIsTestOnly`, `isTestClientKey`.                                                                                                                                                                                                                                                      |
| `types.ts`                                        | Shared types (orders, attempts, profiles, JSON).                                                                                                                                                                                                                                                               |

`shopperReference` is `playground-shopper-<Monday's date>`, rotating weekly (UTC), and shared by
every Sessions and Advanced call; stored cards therefore stay visible for a week.

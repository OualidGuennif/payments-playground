# Security

These are TEST playgrounds. They are built so that a leaked screenshot, a forked repo or a public
URL costs you nothing, but they are not a PCI-certified platform and not a production secret store.

**If you fork this, read the checklist and nothing else is mandatory.**

## Forking checklist

1. **Never put LIVE credentials in it.** The app rejects LIVE endpoints and any client key that does
   not start with `test_`, but do not lean on that, treat it as a seatbelt, not a policy.
2. **Set `PROFILE_ENCRYPTION_KEY`** before deploying anywhere. It encrypts merchant profiles at
   rest, and it is required on Render.
3. **Set `PUBLIC_ORIGIN`** to the exact host browsers will use. It anchors the CSRF origin check;
   get it wrong and every mutation returns 403.
4. **Set `SESSION_SIGNING_SECRET`** to something random. It signs the session and CSRF cookies.
5. **Turn on `PLAYGROUND_BASIC_AUTH_USER` / `PLAYGROUND_BASIC_AUTH_PASSWORD`** if the deployment is
   public. Basic Auth is optional and off by default.
6. **Rotate your Adyen TEST API key** if you ever pasted it somewhere shared.
7. **Never bake a `.env` into an image.** The repo's `.dockerignore` keeps every `.env`,
   `.env.local` and SQLite file out of the build context; pass credentials with `--env-file` or your
   host's environment, and keep that file if you change the Dockerfiles.

Everything below explains why those exist and what they do not cover.

## What stays on the server

`ADYEN_API_KEY`, `ADYEN_HMAC_KEY`, `ADYEN_DEVICE_API_KEY`, the agentic bearer token and the webhook
Basic Auth credentials are read in `packages/platform/config.ts` and used only inside `api.ts` route
handlers. They are never imported from an island, so they cannot reach a browser bundle.

`ADYEN_CLIENT_KEY` is the one credential the browser needs. It is sent only when it starts with
`test_`.

The rule to keep: **anything under `islands/` is public**. If you add a secret, it belongs behind an
API route.

## Card data

Only Adyen Web Drop-in, Components, secured fields and stored-payment-method identifiers are used.
The card number, expiry and CVC live inside Adyen-hosted iframes and never touch this backend.

The API-only flow demonstrates the contract using Adyen's encrypted blobs. **Using it does not by
itself reduce your PCI obligations**, that depends on your integration and your assessor, not on
this repo.

`packages/platform/sanitize.ts` rejects anything that looks like a raw PAN or CVC before it can be
stored or logged. That is a backstop for a mistake, not a licence to send card data.

## Controls in place

**Credentials and configuration**

- LIVE endpoints and non-`test_` client keys rejected outright
- a permanent TEST badge and banner in the UI, so a screenshot is never ambiguous
- profiles encrypted with AES-256-GCM in SQLite
- the default profile comes only from environment variables and cannot be deleted from the UI
- the profile menu reports `configured` or which fields are missing, never the values

**Requests**

- signed, HttpOnly session cookie (`SameSite=Strict`, `Secure` over HTTPS)
- double-submit CSRF token on every `/api/*` mutation, with a same-host origin check
- optional Basic Auth over the whole playground
- in-memory rate limiter
- security headers on every response; deliberately no Content-Security-Policy, which kept blocking
  Adyen and wallet resources (see
  [ADR-005](../knowledge/decisions/ADR-005-no-content-security-policy.md))

**Webhooks and replay**

- standard and header HMAC validation
- webhook deduplication and idempotent lifecycle actions, enforced by unique database constraints

**Logging**

- recursive redaction of sensitive keys, with payload truncation
- explicit rejection of raw card data

## Profiles and secrets

Profiles added through the UI are posted straight to the backend, encrypted, and never returned in
clear. Deleting one is irreversible.

Application-level encryption is not a secret manager. Restrict who can reach your hosting dashboard
and the persistent disk. Rotating `PROFILE_ENCRYPTION_KEY` means migrating or recreating every
encrypted profile, there is no automatic re-encryption.

## What this does not protect against

Stated plainly, so you can decide whether it matters for your fork:

- **The rate limiter is per-process.** Multiple replicas do not share counters.
- **SQLite and encrypted profiles do not fit multiple replicas** without coordination you would have
  to add yourself.
- **Platform logs, backups, operator access and DDoS protection are your host's job**, not this
  repo's.
- **CSRF protection assumes a same-site deployment.** Serving the API on a different origin than the
  UI needs a different design.
- **There is no authentication model beyond optional Basic Auth.** Anyone who can reach the URL can
  use the playground.

None of this is a reason to point it at LIVE credentials, including if you find a way around a
control listed above.

## Reporting something

If you find a problem in this repository, open an issue with enough detail to reproduce it. Do not
include real credentials in the report, TEST ones included.

Vulnerabilities in Adyen's own products go to Adyen's responsible disclosure programme, not here.

# Digital Checkout

An online checkout playground covering five integration paths against Adyen TEST, with a Back Office
that correlates what each one produced.

- **Sessions**: the recommended Drop-in flow
- **Advanced**: `/paymentMethods` + `/payments` + `/payments/details`, driven by the component
- **API only**: server-to-server with Adyen's encrypted card fields
- **MIT**: merchant-initiated, using a stored payment method
- **Pay by Link**: a hosted link, followed through to its webhook

## Quick start

```bash
cp .env.example .env      # then fill in the four Adyen values below
deno task dev             # http://localhost:5173 (Vite)
```

From the repository root, `deno task dev:digital` runs it on port 8001.

| Task              | What it does                        |
| ----------------- | ----------------------------------- |
| `deno task dev`   | Development server with hot reload. |
| `deno task build` | Production build.                   |
| `deno task start` | Serve a build.                      |
| `deno task test`  | Tests.                              |
| `deno task check` | Format, lint and type-check.        |

Health routes: `/healthz` and `/api/health`.

## Environment variables

Copy `.env.example` to `.env`. **Only the first four need a value from you.**

### You must set these

| Variable                 | Where to get it                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `ADYEN_API_KEY`          | Customer Area → Developers → API credentials, **TEST**. Server-side only.                                                |
| `ADYEN_MERCHANT_ACCOUNT` | Your TEST merchant account name, e.g. `YourCompanyECOM`.                                                                 |
| `ADYEN_CLIENT_KEY`       | Same credential page. Must start with `test_`, and `PUBLIC_ORIGIN` must be allow-listed on it.                           |
| `ADYEN_HMAC_KEY`         | Customer Area → Developers → Webhooks → your webhook → HMAC key. Without it, incoming webhooks are rejected as unsigned. |

### Set these only when you deploy

| Variable                 | Default if unset                                        | When it matters                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`          | `http://localhost:<PORT>`                               | The exact origin browsers use. Anchors the CSRF check and builds the return URLs Adyen redirects back to. Also where your webhook points: `${PUBLIC_ORIGIN}/webhook`. |
| `PROFILE_ENCRYPTION_KEY` | A key file next to the database, generated on first run | Encrypts profiles added through the UI. **Required** on Render or Deno Deploy. 32-byte Base64 or 64-character hex.                                                    |
| `SESSION_SIGNING_SECRET` | A new random value on every boot                        | Signs the session and CSRF cookies. Without it, restarting logs everyone out.                                                                                         |

### Rarely worth touching

| Variable                                      | Default                 | Notes                                                                                    |
| --------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`                                        | `8000`                  | Render sets this for you.                                                                |
| `DATABASE_PATH`                               | `./data/digital.sqlite` | Orders, attempts, webhooks and the API log. Needs a persistent disk to survive a deploy. |
| `PLAYGROUND_BASIC_AUTH_USER` / `..._PASSWORD` | off                     | Puts the whole playground behind Basic Auth. Worth setting if the deployment is public.  |

## Webhooks

Point a **TEST** standard webhook at `${PUBLIC_ORIGIN}/webhook` and copy its HMAC key into
`ADYEN_HMAC_KEY`.

Locally that address is not reachable from Adyen, so use a tunnel (`cloudflared`, `ngrok`) and set
`PUBLIC_ORIGIN` to the tunnel URL. Without a webhook the payment flows still work, you just will not
see the asynchronous half: captures, refunds, chargebacks and Pay by Link completion.

Redelivery is safe. Webhooks are deduplicated and lifecycle actions are idempotent, both enforced by
unique database constraints rather than by retry logic.

## Where things live

The side panel on the Drop-in and Component pages keeps callbacks, API calls and webhooks, redacted.
The Back Office shows the timeline and explains why a lifecycle action is unavailable rather than
hiding it.

Per-method capabilities, what can be captured, refunded, cancelled, live in
[`packages/platform/payment-methods.ts`](../../packages/platform/payment-methods.ts) and are meant
to be edited without touching flow code.

## Docker and Render

```bash
docker build -f apps/adyen-digital/Dockerfile -t digital-checkout:test .
docker run --rm --env-file apps/adyen-digital/.env -p 8000:8000 digital-checkout:test
```

The local `render.yaml` describes this service on its own; the one at the repository root deploys
all four together. This app needs a persistent disk, it is the one that stores orders.

## Disclaimer

A playground for exploring and testing Adyen against its **TEST** environment. Not a product, not a
reference integration, and not intended to be deployed to production as-is. Not built or supported
by Adyen.

If you reuse any of this, you alone remain responsible for your own payment stack, PCI scope,
regulatory compliance, security review and the correctness of your flows. Provided as is, with no
warranty and no liability, under the MIT Licence.

Full text: [Disclaimer](../../README.md#disclaimer) · [Security](../../docs/SECURITY.md) ·
[Known limits](../../docs/KNOWN_LIMITS.md)

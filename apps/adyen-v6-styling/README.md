# Drop-in Styling

A workbench for theming the Adyen Web Drop-in. The checkout is live on the left, every option Adyen
exposes is on the right, and it re-renders as you change things. Copy the result out as a JSON
config, a CSS file, or both.

No orders, no back office, no database rows, it creates a TEST session, mounts a Drop-in, and keeps
your panel settings in `localStorage`.

## Quick start

```bash
cp .env.example .env      # then fill in the three Adyen values below
cd ../.. && bun run dev:styling   # http://localhost:8004
```

From the repository root, `bun run dev:all` runs it alongside the other two playgrounds.

| In this folder      | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `bun run dev`       | Development server with hot reload.                              |
| `bun run build`     | Production build (standalone).                                   |
| `bun run start`     | Serve a build.                                                   |
| `bun run test`      | Tests, including the CSS token audit (needs network, see below). |
| `bun run typecheck` | Type-check.                                                      |

## Environment variables

Copy `.env.example` to `.env`. **Only the first three need a value from you.**

### You must set these

| Variable                 | Where to get it                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ADYEN_API_KEY`          | Customer Area → Developers → API credentials, **TEST**. Server-side only; never reaches the browser.                                 |
| `ADYEN_MERCHANT_ACCOUNT` | Your TEST merchant account name, e.g. `YourCompanyECOM`.                                                                             |
| `ADYEN_CLIENT_KEY`       | Same API credential page. Must start with `test_`, and the **origin below must be allow-listed on it** or the Drop-in will not load. |

### Set these only when you deploy

| Variable                 | Default if unset                                        | When it matters                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`          | `http://localhost:<PORT>`                               | The exact origin browsers use. It anchors the CSRF check, a mismatch turns every request into a 403. Must also be allow-listed on your client key.               |
| `PROFILE_ENCRYPTION_KEY` | A key file next to the database, generated on first run | Encrypts profiles added through the UI. **Required** on Render or Deno Deploy, the app refuses to save a profile without it. 32-byte Base64 or 64-character hex. |
| `SESSION_SIGNING_SECRET` | A new random value on every boot                        | Signs the session and CSRF cookies. Fine to leave unset locally; without it, restarting logs everyone out and two instances reject each other's cookies.         |

### Rarely worth touching

| Variable                                      | Default                 | Notes                                                                                   |
| --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `PORT`                                        | `8000`                  | Render sets this for you.                                                               |
| `DATABASE_PATH`                               | `./data/styling.sqlite` | Only holds profiles in this app.                                                        |
| `PLAYGROUND_BASIC_AUTH_USER` / `..._PASSWORD` | off                     | Puts the whole playground behind Basic Auth. Worth setting if the deployment is public. |

This app needs **no HMAC key and no webhook**: it never takes a payment to completion server-side,
so there is nothing to notify.

## What the three panel tabs do

- **Field styles**: the `styles` object. The card number, expiry and security code render inside
  Adyen-hosted iframes, so no page CSS can reach them; this object is the only way to style them.
  Four states: base, placeholder, error, validated.
- **Components**: the configuration objects: Drop-in behaviour, card fields, and Apple Pay / Google
  Pay / PayPal. Wallet buttons are drawn by the provider, so neither your CSS nor the field styles
  reach them, only each vendor's own options do.
- **Theme**: the `--adyen-sdk-*` custom properties Adyen Web reads. This is the supported way to
  theme everything outside the secured fields.

The **theme picker** next to the market selectors applies a whole look at once. _Adyen default_
changes nothing at all; _Mono_, _Contrast_ and _Soft_ are starting points you can then edit, the
picker falls back to _Custom_ as soon as you do.

At the bottom of the Theme tab, **Class-name rules** targets Adyen's internal class names. It is
marked in red because those names are private API: they can be renamed in any release, with no
deprecation, and a checkout styled that way can break on an upgrade. Prefer a token wherever one
exists.

Your whole configuration survives a reload. **Reset** is the only thing that clears it, and it asks
first.

## Exports

Both are copy-or-download, at the bottom of the relevant tab:

- a JSON config to pass to `AdyenCheckout` / `Dropin`
- a CSS file to import **after** `@adyen/adyen-web/styles/adyen.css`

## About the token audit test

`components/adyenOptions.test.ts` fetches the real `adyen.css` for the pinned SDK version and fails
if the panel offers a custom property Adyen no longer reads, or misses one it added. That is
deliberate: merchants paste this output into production stylesheets, so an SDK bump should not pass
quietly. **It needs network access**: offline it fails on the fetch, not on a real regression.

## Docker

```bash
docker build -f apps/adyen-v6-styling/Dockerfile -t dropin-styling:test .
docker run --rm --env-file apps/adyen-v6-styling/.env -p 8000:8000 dropin-styling:test
```

## Troubleshooting

| Symptom                                              | Cause                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Drop-in never appears                                | The client key does not allow-list `PUBLIC_ORIGIN`, or it does not start with `test_`.       |
| Every action returns 403                             | `PUBLIC_ORIGIN` does not match the host in the browser's address bar.                        |
| "The provided session identifier or data is invalid" | Adyen sessions are single-use. Use **New payment** after a completed one.                    |
| Apple Pay button missing                             | Apple Pay only renders in Safari, on a verified domain, with your own Apple sandbox account. |

## Disclaimer

A playground for exploring and testing Adyen against its **TEST** environment. Not a product, not a
reference integration, and not intended to be deployed to production as-is. Not built or supported
by Adyen.

If you reuse any of this, you alone remain responsible for your own payment stack, PCI scope,
regulatory compliance, security review and the correctness of your flows. Provided as is, with no
warranty and no liability, under the MIT Licence.

Full text: [Disclaimer](../../README.md#disclaimer) · [Security](../../docs/SECURITY.md) ·
[Known limits](../../docs/KNOWN_LIMITS.md)

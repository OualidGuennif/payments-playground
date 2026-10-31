---
type: Component
title: "landing: the static front door to the four playgrounds"
description: "The plain HTML and CSS page that links to the four Adyen TEST playgrounds, with no build step, no server, no JavaScript and no data of its own."
tags: [component, landing, static]
status: stable
scope: component-landing
generated:
  by: aeion-adoption/1.0
  at: 2026-10-31
sources:
  - id: app
    resource: ../../apps/landing
    title: "The page and its stylesheet"
  - id: html
    resource: ../../apps/landing/index.html
    title: The four destination cards, status labels and disclaimer
  - id: css
    resource: ../../apps/landing/styles.css
    title: The self-contained presentation
  - id: render
    resource: ../../render.yaml
    title: The static Render service, publish path and headers
  - id: readme
    resource: ../../README.md
    title: The application table and statuses the page mirrors
---

# landing

## Intent

The front door: one page that says what the four playgrounds are, labels two as Ready and two as in
progress, and links to each one's own subdomain. It is deliberately not a fifth app. It is plain
HTML and CSS with no build, no server and no runtime data, deployed as a Render static site. The
playgrounds do not link back to it.

## Data sources

| Source                     | What is read                                                                                 | Owner      | Freshness      |
| -------------------------- | -------------------------------------------------------------------------------------------- | ---------- | -------------- |
| `apps/landing/index.html`  | Copy, the four destinations, status labels, disclaimer and footer                            | Repository | Per deploy     |
| `apps/landing/styles.css`  | Every colour, layout and responsive rule; no external font or asset                          | Repository | Per deploy     |
| `render.yaml`              | `runtime: static`, `staticPublishPath: ./apps/landing`, empty `buildCommand` and the headers | Repository | Per deploy     |
| The root `README.md` table | The status wording and the Q4 2026 / Q1 2027 estimates that the page repeats                 | Repository | Edited by hand |

There is no API, database, cookie, `localStorage` or third-party request. The page does not read the
playgrounds at runtime; a status change is an edit in both this page and the README.

## Inputs

A browser requests `/` (or `/index.html`) and `/styles.css`. The page consumes no query string, body
or application header, and runs no JavaScript. The stylesheet is linked relatively (`./styles.css`),
so the same files work from any static host and from the filesystem. The favicon is a data-URI SVG
in the document, not a file request.

The four destinations are fixed:

| Card             | Destination                                | Label on the page          |
| ---------------- | ------------------------------------------ | -------------------------- |
| Drop-in Styling  | `https://styling.payments-playground.com`  | Ready                      |
| Digital Checkout | `https://digital.payments-playground.com`  | Ready                      |
| Endless Aisle    | `https://terminal.payments-playground.com` | In progress · est. Q4 2026 |
| Agentic Commerce | `https://agentic.payments-playground.com`  | In progress · est. Q1 2027 |

The comment in the page notes that these hosts resolve once the custom domains are attached in
Render; until then each app stays reachable at its own `.onrender.com` hostname.

## Outputs

One HTML document with:

- a header (`Payments Playground`, a `TEST` badge), a hero note that none of this is a product or a
  reference integration, the four cards above, a legal disclaimer and a footer with the copyright
  line and a Source link;
- one stylesheet with the green/blue page glows, the card grid, the Ready/in-progress treatments and
  the narrow-screen layout;
- no scripts, forms, cookies or storage.

On Render the static service adds `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin` to every path. The document itself also carries
`robots: noindex,nofollow`.

There are no application refusals: a missing path is the static host's `404`, and no route computes
a response.

## Invariants

| # | Invariant                                                                                                                                    | Test / file                                                          |
| - | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1 | There is no build step and no server: Render publishes `./apps/landing` directly with an empty build command.                                | `render.yaml`; [README](../../README.md)                             |
| 2 | The page links to exactly the four playgrounds and no playground links back to it.                                                           | `apps/landing/index.html`; `packages/ui/components.tsx` (`AppShell`) |
| 3 | Status labels match the README: Styling and Digital Ready, Endless Aisle Q4 2026, Agentic Commerce Q1 2027.                                  | `apps/landing/index.html`; [README](../../README.md)                 |
| 4 | The page is self-contained: no external font, image, script or analytics request; the favicon is a data URI.                                 | `apps/landing/index.html`; `apps/landing/styles.css`                 |
| 5 | The TEST-only, independent-project disclaimer and the MIT/no-warranty wording are present, and Adyen is not implied to endorse it.           | `apps/landing/index.html`; [README](../../README.md)                 |
| 6 | Render applies the security headers to every path; the page has no server middleware of its own.                                             | `render.yaml`                                                        |
| 7 | The stylesheet is linked relatively and the document has no absolute asset path, so the folder can be published at a root or opened locally. | `apps/landing/index.html`; `apps/landing/styles.css`                 |
| 8 | No JavaScript, cookie or storage is used; the status is static until the file is edited.                                                     | `apps/landing/index.html`; `apps/landing/styles.css`                 |

## Determinism

Deterministic: the deployed bytes are the files in `apps/landing`. There is no server, no data
source, no model and no runtime composition; the only variation is the browser's rendering of the
same document. A status or destination change is a source edit and a deploy, never a live read.

## Acceptance checks

```bash
deno fmt --check apps/landing
rg -o 'https://[a-z]+\.payments-playground\.com' apps/landing/index.html | sort -u
rg -n '<script|localStorage|cookie|@import|https://fonts' apps/landing
```

The first command passes when the HTML/CSS is formatted; the second lists exactly the four
destinations; the third must print nothing. Manual pass: open `index.html` directly, follow each
card, and confirm the page makes no request other than `styles.css`.

## Out of scope

- No playground behaviour, checkout, API, authentication or persistence; it only links out.
- No build pipeline, framework, bundler or server process.
- No live status, health check, analytics or usage counter; the labels are copied by hand.
- No automatic deployment beyond the static service in `render.yaml`, and no custom-domain
  provisioning in this repository.
- No link from a playground back to the landing page, and no navigation shared with the apps.
- No production/LIVE content: the page is a TEST-only index and says so.

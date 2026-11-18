# Known limits and simulations

What these playgrounds do not do, and where something is simulated rather than real. Read this
before concluding that an integration is proven.

## What "verified" means here

No payment path is described as working without live Adyen TEST credentials, enabled payment
methods, an allow-listed origin and an active webhook. Builds, local contracts, security checks and
mocks are all verifiable without ever taking a transaction, but they prove the code runs, not that
your Adyen account is configured.

## Agentic Commerce

The store speaks UCP 2026-08-25 (REST and MCP) behind PAP 1.0 sign-in. No language model runs in the
app: the agent is whatever MCP client the shopper points at it, and `scripts/pap-agent.ts` is a
scripted one for local runs. **No output is presented as a response from OpenAI, Google or Adyen.**

An agent payment is an ordinary Adyen Checkout TEST `/payments` call on the demo shopper's saved
card (`ContAuth`, `UnscheduledCardOnFile`). It is not Adyen's own agentic tokenizer or UCP payment
handler, which needs an account role this repository does not have; the handler id `saved_card` is
the store's own, not an Adyen one.

Every UCP REST request must name a platform profile the store can fetch (`UCP-Agent:
profile="<https url>"`); a `curl` with a made-up URL now gets `profile_unreachable` (424). An MCP
call without `meta["ucp-agent"]` still runs, a deviation kept so generic MCP clients work. The store
fetches a profile without redirects, within 5 seconds and 256 KiB, and an https profile URL may not
name an IP literal. Before fetching any URL an agent gave it (a profile, a client document, a
`jwks_uri`), it resolves the host and refuses one that gives a private or link-local address, and a
loopback one unless the store itself runs on a loopback `PUBLIC_ORIGIN`, as a local run does. The
fetch resolves the name again, so a name whose answer changes in between (DNS rebinding) can still
be reached. It speaks UCP 2026-08-25 only and verifies no UCP message signature.

There is one demo shopper (`ogaccountnew`) and no shopper login. The consent page, the account and
the Back Office are protected only by the playground's basic auth when it is set; without it, anyone
who can reach the store, an agent included, can approve its own sign-in request.

Adyen cannot reach `localhost`, so a local run never receives the `AUTHORISATION` webhook; an order
is still placed from the synchronous `/payments` answer. From v0.3.2 the Render Blueprint puts the
SQLite file on a 1 GB disk so it outlives a deploy; before, each deploy emptied it. It is not backed
up, and a local run without `DATABASE_PATH` writes `data/agentic.sqlite` under its working
directory.

## Payments

What a payment method can do varies by country, merchant contract, the method itself and how it is
configured. iDEAL, MB WAY and PayPal's settlement-only default are documented in
`packages/platform/payment-methods.ts`, but that file is this repo's model of Adyen's behaviour ,
not Adyen's answer. The Back Office does not replace the API response or the Customer Area.

A capture has been accepted on TEST and a CAPTURE notification settles the order, but a refund has
not been exercised yet, and cards are modelled as captured manually: on a merchant account that
captures automatically, capture is still offered. Without a webhook reaching the server, a card
order stops at "authorised". The dated, evidence-backed list is
[knowledge/current/digital-status.md](../knowledge/current/digital-status.md).

## Styling

The `styles` object reaches the secured fields, which render in Adyen-hosted iframes. **CSS cannot
cross into those iframes**, nothing in your stylesheet will change the card number field.

Design tokens (`--adyen-sdk-*`) are the supported way to theme everything else. The class-name rules
the panel also offers target Adyen's internal selectors, which are private API and can be renamed in
any release. A checkout styled that way can break on an upgrade; the panel marks it in red for that
reason.

Exports should be reviewed after every Adyen Web version bump. The token audit test enforces the
part that can be automated, it fails if the panel's catalogue and the shipped `adyen.css` disagree.

## Persistence and operations

SQLite fits development and a single-instance deployment with a persistent disk. Scaling out needs
PostgreSQL, distributed locking, a webhook queue and a shared rate limiter, none of which are here.

Backups and retention are not automated. See [SECURITY.md](SECURITY.md) for the rest of what is left
to your host.

## Container user

The images start as root only inside `tools/docker/entrypoint.sh`: it chowns the Render disk
(`/var/data`) and `/app/data` to the image's `app` user (uid 1993), then `setpriv` drops to that
user before the app starts. A plain `USER app` is not enough: on 2026-10-31 the Render disk was
`root:1000 2775` and its SQLite files were `root:1000 644`, so uid 1993 cannot open the WAL. The
SAST missing-user rules are waived inline in the Dockerfiles because the runtime process is not
root; revisit if Render changes disk ownership or the entrypoint is removed.

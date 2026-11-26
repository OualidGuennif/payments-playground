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

An agent pays with an ordinary Adyen Checkout TEST `/payments` call (`ContAuth`,
`UnscheduledCardOnFile`): on a card the signed-in account saved (handler `saved_card`), or on a
network token the agent brings (handler `network_token`: number and expiry only, no cryptogram, the
brand read from `/cardDetails`). On TEST a test card number stands in for a real scheme token. An
agent may also hand the checkout to the shopper, who pays in Drop-in at `continue_url`. Neither
handler is Adyen's own agentic tokenizer or UCP payment handler, which needs an account role this
repository does not have; both handler ids are the store's own, not Adyen ones.

Every UCP REST request must name a platform profile the store can fetch (`UCP-Agent:
profile="<https url>"`); a `curl` with a made-up URL now gets `profile_unreachable` (424). An MCP
call without `meta["ucp-agent"]` still runs, a deviation kept so generic MCP clients work. The store
fetches a profile without redirects, within 5 seconds and 256 KiB, and an https profile URL may not
name an IP literal. Before fetching any URL an agent gave it (a profile, a client document, a
`jwks_uri`), it resolves the host and refuses one that gives a private or link-local address, and a
loopback one unless the store itself runs on a loopback `PUBLIC_ORIGIN`, as a local run does. The
fetch resolves the name again, so a name whose answer changes in between (DNS rebinding) can still
be reached. It speaks UCP 2026-08-25 only and verifies no UCP message signature.

A client assertion may be signed with ES256, ES384, PS256, PS384, RS256 or EdDSA, so an MCP client
known by its client metadata document gets its token. A Poppy-Session's delegation still takes
only PAP's ES256 or PS384: a client whose published keys allow neither can call `/mcp` with its
bearer token alone, but a Session it sends is `invalid_session`.

A client assertion's `aud` may be the issuer, the issuer with a final slash, or the store's token
endpoint URL. PAP 1.0 §4.1 allows only the issuer; the owner chose on 2026-11-18 to accept the
token endpoint too, because ChatGPT's MCP connector was refused without it
([ADR-016](../knowledge/decisions/ADR-016-client-assertion-audience-for-mcp-clients.md)). An array
is still refused. A client tricked by another authorization server into signing an assertion for
this token endpoint can have it replayed here once, within its lifetime of at most 300 s.

Shoppers open their own accounts with a password and may add passkeys; passkeys have been tried only
with a software authenticator, not on a real device. Raising an agent's spend limit asks for the
password or a passkey every time, and so does adding a passkey; the session alone may lower a limit
or disconnect the agent. A limit is at most EUR 1000 when set from v0.5.3 on (one set higher before
stays until changed) and is not split per day or per order. An email address is never verified, and there
is no password reset and no account deletion. Approving an agent needs a signed-in account, and the
agent then acts for that account alone. Sign-in, sign-up, the account, consent, device approval and
the Back Office sit behind the playground's basic auth when it is set; the shop, cart, checkout and
order pages stay public, so a shopper handed a `continue_url` can pay without that pair. Without the
basic auth, any client that reaches the store, an agent included, can open an account and approve
its own sign-in to it, an account with no saved card.

The payment lock (one payment at a time per checkout) is complete on the agent side, which pays
from the server. On the website, Drop-in's Sessions flow sends the payment from the browser to
Adyen, and the store's hold is asked in `beforeSubmit`: a modified browser that skips it can still
get a second authorisation. The store then places no second order (the checkout is already
completed), and the extra authorisation is cancelled by hand in the Customer Area.
A checkout's id is its link: whoever holds `continue_url` may pay it, and pressing Pay in the
payment form there holds the checkout, and its account's other payments, for up to 15 minutes, so
a holder of that link can also delay the account that way. A form that fails in the browser before Adyen
answers does not tell the store; its hold simply runs out. A 3-D Secure challenge that outlasts
the hold lets an agent, or the form in another tab, pay meanwhile. The store learns of a browser's
payment only when Adyen answers it, so the checkout may reopen while that payment is still being
authenticated (a refusal of an earlier card in the same form that lands then also ends the form's
hold), or when a late refusal of an earlier card lands after a retry Adyen left pending without
naming it. After a refusal webhook, a retry in the same form that Adyen leaves pending is shown as
pending when Adyen's answer names it; otherwise the form's hold covers it for 15 minutes, and its
webhook still settles it. An agent that completes again after a network
error with another bag or card, or after the shopper's form started a new attempt, sends a new
payment while the first one's outcome is still unknown.
When two payments are authorised, the second is cancelled by hand, as above. A signed-in shopper who opens the
payment form of a checkout no account holds becomes that checkout's account, and a checkout an
agent created without a token stays open to any agent that has its id.

Code Mode (`/mcp/code`) runs the agent's JavaScript in QuickJS on the server's main thread, not in
a separate process or worker. One run can hold the store for at most half a second of interpreter
time; an address gets 10 runs a minute and all runs together 10 seconds a minute. Many addresses
at once could still slow the store within that budget.

Adyen cannot reach `localhost`, so a local run never receives the `AUTHORISATION` webhook; an order
is still placed from the synchronous `/payments` answer. The Render Blueprint has put the SQLite
file on a 1 GB disk since v0.3.2, but the service used the disk only from 2026-11-18, once
`DATABASE_PATH` was set on it; before, each deploy emptied the store. It is not backed
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

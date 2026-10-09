# Known limits and simulations

What these playgrounds do not do, and where something is simulated rather than real. Read this
before concluding that an integration is proven.

## What "verified" means here

No payment path is described as working without live Adyen TEST credentials, enabled payment
methods, an allow-listed origin and an active webhook. Builds, local contracts, security checks and
mocks are all verifiable without ever taking a transaction, but they prove the code runs, not that
your Adyen account is configured.

## Agentic Commerce

Mock mode is a deterministic local simulation, and every step carries its own status. **No output is
presented as a response from OpenAI, Copilot, Google or Adyen.**

Adyen's public material describes agentic integrations as a pilot, and no publicly verifiable TEST
contract was available to build against. Real mode therefore answers `501` and contacts no endpoint,
rather than shipping a convincing fake.

The human-confirmed payment is a standard Adyen Checkout TEST session. It is not an Agentic Commerce
API call, and the UI does not claim otherwise.

## In-person payments (IPP)

Mock mode calls Adyen not at all.

Real TEST mode needs more than credentials: a Cloud Device credential authorised for your terminal,
a TEST terminal that is powered on and online, the merchant account that terminal is assigned to,
and the exact POIID. Cloud mode reaches the terminal through Adyen, so a terminal that is asleep or
off the network simply does not answer, and no hosting platform can wake it for you.

Asynchronous follow-up depends on your Terminal API webhook configuration.

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

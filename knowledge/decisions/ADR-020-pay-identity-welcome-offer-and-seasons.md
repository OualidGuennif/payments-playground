---
type: Decision
title: "ADR-020: One Pay email step that recognises an account, a first-order welcome offer and seasons a month early"
description: "Owner, 2026-11-27: Pay asks for an email in one modal that knows an account (hardened boolean check), an opt-in first-order offer (5 %, seasonal tote) priced on the server, seasons from the 21st."
tags: [decision, agentic, checkout, accounts, pricing, seasons, security]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T08:00:00Z
sources:
  - id: storefront
    resource: ../components/agentic-storefront.md
    title: "The storefront's spec: Pay modal, welcome offer, seasons, header"
  - id: store
    resource: ../components/adyen-agentic-commerce.md
    title: "The store's spec: accounts, checkout, pricing, UCP totals"
  - id: ask
    resource: ../components/ask-agent.md
    title: "The Ask agent's spec: the Personal Shopper's Pay and bag"
  - id: ucp-total
    resource: https://github.com/Universal-Commerce-Protocol/ucp/blob/main/source/schemas/common/types/total.json
    title: "UCP Total schema: a discount amount is negative (read 2026-11-27)"
---

# ADR-020: Pay email step, first-order welcome offer, seasons a month early

**Status.** Accepted by the owner on 2026-11-27, in chat, on the v0.11.0 plan whose Section 0 lists
these decisions as approved ("garde ça quand même en mode bien sécurisé" for the email check).

## Context

A returning shopper who was not signed in met a dead end on Pay: the Personal Shopper showed a red
"needs an email" line next to "Checkout ready." and a receipt block below the delivery choice, and
`/checkout` asked for an email in a field with no clear next step. Nothing told an account holder
to sign in, so their saved cards stayed out of reach. The store had no reason to create an account
on a first order, and nothing on the page showed the time of year.

## Decision

1. **Email check.** `POST /api/session/check-email` answers `{ "exists": boolean }` and nothing
   else. It refuses another site (the proxy's cross-site refusal, plus `Origin` and
   `Sec-Fetch-Site` read again in the handler), wants the header `X-Velune-Check: 1`, counts 15
   calls per client address per 15 minutes before it reads the body, checks the email's shape,
   never answers in less than about 45 ms, sends `Cache-Control: no-store` and traces the email
   masked. Sign-in keeps its single "Wrong email or password".
2. **One Pay step.** Pay with no email opens one modal, "Add your email address", on `/checkout`
   and in the Personal Shopper: an account's email leads to sign-in (password or passkey), a new
   one to two choices, an account with the welcome offer or Pay as guest. A guest email stays
   set-once; a new authenticated claim binds an open guest checkout to the signed-in customer.
3. **Welcome offer.** A customer with no order yet who asks for it (the claim's
   `applyWelcomeOffer: true`, or the same flag on checkout creation) gets 5 % off the item subtotal
   and a free seasonal tote line at €0.00. The server computes it, sends the discounted amount to
   Adyen TEST, checks eligibility again before the payment session and records it on the payment
   and the order. Free delivery is judged on the subtotal before the discount. The tote is not a
   catalogue product: no feed row, no line an agent can order. UCP shows the discount as a total of
   type `discount` with a negative amount, as UCP's Total schema requires.
4. **Seasons.** Winter from 21 November, spring from 21 February, summer from 21 May, autumn from
   21 August (UTC). The season names the tote and the top bar ("Winter Edition · Agentic Commerce
   Sandbox"), and a faint ambience (at most 16 particles, CSS only, no pointer events) shows
   it; reduced motion hides it.
5. **Header.** Sign in, or the account's initial, sits in the header on every width; the Menu
   no longer carries it.

## Consequences

- The email check tells whether an address has an account, which the store refused to show before
  (the Ask receipt block's "no account enumeration"). The owner accepts this bounded disclosure for
  a clearer Pay: same-origin only, a header no other site can send without a refused preflight,
  15 answers per address per quarter hour, a boolean and no timing difference worth measuring.
- An order's amount now depends on the checkout's offer as well as its lines and delivery; the
  payment record keeps the offer, so a webhook's amount is checked against the price as offered.
- Two tabs that claim the offer on two checkouts cannot both use it: the second payment session
  finds an order and refuses with `welcome_offer_ineligible`, removing the offer.
- Checkouts and UCP answers without the offer keep their three totals and exact prices.

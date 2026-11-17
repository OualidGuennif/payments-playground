---
type: Decision
title: "ADR-015: Customer accounts, two channels and agent network tokens in the agentic store"
description: "Customer accounts (password, passkeys), web and agent channels on every order, agent grants bound to an account, and a one-time network token an agent brings, paid on Adyen as networkToken with mpiData."
tags: [decision, agentic, accounts, passkeys, network-token, ucp]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-17T21:00:00Z
sources:
  - id: spec
    resource: ../components/adyen-agentic-commerce.md
    title: The store's spec
  - id: adyen-network-tokens
    resource: https://docs.adyen.com/online-payments/network-tokenization
    title: "Adyen: Manage network tokens yourself (networkToken, mpiData)"
  - id: ucp-network-token
    resource: https://ucp.dev/2026-08-25/schemas/common/types/network_token_credential.json
    title: "UCP 2026-08-25: network token credential"
---

# ADR-015: Customer accounts, two channels and agent network tokens

**Context.** Until v0.3.x the store had one demo shopper (`ogaccountnew`): every agent paid with
that shopper's saved card, and the account and consent pages had no sign-in of their own. On
2026-11-17 the owner asked for a simple customer account usable by a person and by the agent acting
for them, for the browser and agent flows to stay clearly apart, and for an agent to pay with its
own card, brought as a one-time network token, never a clear card number.

**Decision.**

- **Accounts.** A customer signs up with an email and a password (argon2id through `Bun.password`)
  and may add passkeys (WebAuthn through `@simplewebauthn/server` and `/browser` 14, approved by
  the owner on 2026-11-17). A session is an opaque random token in a `__Host-` cookie (HttpOnly,
  Secure, SameSite=Lax), stored hashed, valid 7 days. Each account has its own Adyen
  `shopperReference` (`cus_…`), so its saved cards are its own. No email is sent: emails are not
  verified and there is no password reset; a customer who forgets the password signs in with a
  passkey or opens a new account.
- **No inheritance of `ogaccountnew`.** The plan offered to hand the old demo shopper's cards to
  the account opened with the owner's email. Without email verification, whoever registers that
  address first would get them, so no account inherits them; the owner saves a TEST card again.
- **Two channels.** Every checkout, payment and order records `channel` (`web` for `/api` and the
  pages, `agent` for UCP REST and MCP) and, when known, `customerId`. The Back Office filters by
  channel; the account page shows the customer's orders from both. The browser API never takes a
  bearer token and never charges a saved card without the shopper in Drop-in.
- **Agents act for an account.** Consent and device approval need a signed-in customer; the grant
  records `customerId`, and the agent then uses that account's buyer details and saved cards.
  Grants made before accounts have no customer and stop working: their agents sign in again.
  Reading a checkout, cart or order through a token also needs the token's account.
- **Agent network tokens.** A second payment handler, `network_token`, takes UCP's
  `network_token_credential` (number, expiry, `cryptogram`, `eci_value`) on `complete_checkout`.
  The store sends `/payments` with `paymentMethod.type: networkToken` and `mpiData` (TAVV,
  `eci`, `directoryResponse` and `authenticationResponse` `Y`), `shopperInteraction: Ecommerce`,
  no stored-payment fields. The credential is never stored, traced, logged or echoed; a refused
  payment needs a new cryptogram. A guest agent may pay this way; a signed-in agent's payments,
  whatever the instrument, count against its grant's limit.
- **Rate limits** on Drop-in payment sessions, card-save sessions and failed sign-ins.

**Consequences.** Real network-token payments on TEST need Adyen Support to enable payments with
network tokens on the merchant account, and a source of test tokens with cryptograms, which Adyen
does not publish; until then the path is proven against the test double only. The accounts live in
SQLite, so they need the agentic disk on Render. A new dependency (`@simplewebauthn`) enters the
store.

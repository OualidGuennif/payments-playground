---
type: Decision
title: "ADR-021: A durable Personal Shopper grant, a 60-minute confirmation to pay in chat, and checkout that stays in the chat"
description: "Owner, 2026-11-27: the house agent's grant survives sessions, sign-ins and deploys (one per account); paying in chat needs a password or passkey proven in the last 60 minutes; Pay opens overlays above the chat, never another page."
tags: [decision, agentic, ask, oauth, security, checkout, mobile]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T18:30:00Z
sources:
  - id: ask
    resource: ../components/ask-agent.md
    title: "The Ask agent's spec: session, connection, panel, widget host"
  - id: store
    resource: ../components/adyen-agentic-commerce.md
    title: "The store's spec: accounts, sessions, grants, step-up"
  - id: storefront
    resource: ../components/agentic-storefront.md
    title: "The storefront's spec: Pay email modal, Personal Shopper sheet, layers"
  - id: adr-018
    resource: ADR-018-ask-agent-flue-in-process.md
    title: "ADR-018: the Ask agent and its house client"
---

# ADR-021: Durable Personal Shopper grant, 60-minute chat-pay confirmation, checkout in the chat

**Status.** Accepted by the owner on 2026-11-27, in chat, on the v0.13.0 plan whose section 1
lists these decisions as approved, with the iPhone Safari screenshots of v0.12.0 as evidence.

## Context

The house agent's connection lived only in the Ask session's memory. A new conversation, a reload
after the session's 30 minutes, a sign-in from another tab or a deploy dropped it, while
`/account#agents` still listed the grant as connected with its budget. The chat then asked the
shopper to choose a budget again, created a second grant, and its widget read a checkout without the
account's token, so it said "No card is saved" to a shopper with two saved cards. Pay in the chat
opened `/checkout/:id`, which took the shopper out of the conversation, and the Pay email modal,
anchored to the bottom of the layout viewport, sat under the iOS keyboard. On a phone the sheet left
about 120 px for the conversation.

## Decision

1. **The grant is durable, its token is not.** A conversation that ends normally (time, idle,
   messages, budget, signed out, another customer, a new conversation, ended by the shopper or the
   console) forgets its access token and revokes that access token only; the grant stays until the
   shopper disconnects it on `/account#agents`. A lock, whichever path locks (the gate, the guard's
   score, the console), revokes every live house grant of the account, also after a restart.
2. **A signed-in shopper's conversation resumes the grant.** While a conversation is live and in
   normal mode, the store takes the account's newest active Atelier Velune Ask grant and mints an
   access token for it in the process's memory (the database keeps only its hash, like every
   token), with the grant's own scopes and budget. It never creates, widens or revives a grant.
   An account keeps at most one active house grant: resuming revokes older active ones (left by
   restarts before this decision), and the one-click connect with an active grant reuses it and
   keeps its limit; a higher limit goes through the account's step-up.
3. **Paying in the chat needs a recent proof.** A customer session records when it signed in
   (`createdAt`) and when the shopper last proved it with the password or a passkey
   (`confirmedAt`). It is fresh for 60 minutes after the later of the two; a session created
   before v0.13.0 has neither and is not fresh. A saved-card `complete_checkout` from the
   Personal Shopper needs a fresh session: the widget's tap is answered 401 `step_up_required` and
   the panel asks for the password or a passkey (`POST /api/ask/confirm-pay`, the account's own
   check and limits), then retries the same payment; the agent's own call is refused in words and
   it hears `autonomous pay: no` until then. Browsing, the bag, the checkout, the connection and the
   saved-card count need only the session. Any successful step-up (a budget change, a new passkey,
   a chat payment's confirmation) refreshes the 60 minutes.
4. **Checkout stays in the chat.** Pay in the Personal Shopper opens overlays above the chat: the
   Pay email modal (sign in, new account, guest), a card save in Drop-in, a budget to allow or to
   raise (with the step-up), and the chat-pay confirmation. After each, the panel reads the session
   and the checkout again in place. `/checkout/:id` opens only when the shopper taps "Continue on
   website checkout", the checkout card's last action. Every overlay is top-aligned inside the
   visual viewport on a phone, so the iOS keyboard never covers its field or its button.
5. **One order of actions in the chat's checkout card.** A guest with no email: Pay. Signed in,
   connected, with a card and the budget: Pay in chat. Over budget: Raise budget and pay in chat.
   Not connected with a card: Allow and pay in chat. No card: Save a card and pay in chat. A guest
   with an email: Save a card and pay in chat, through a new account with the welcome offer. Then,
   always last and quieter: Continue on website checkout. "No card is saved" shows only when the
   store, with the account's token, lists none. Outside the store's panel (ChatGPT and other MCP
   hosts) the widget keeps its links.
6. **A taller, calmer sheet.** On a phone the Personal Shopper opens at 88 % of the dynamic
   viewport (96 % when enlarged); the budget card leaves the footer, the suggested questions show
   only before the first message, the closing time moves to the header, and product cards are
   compact and aligned (4:3 pictures, two-line titles, actions at the bottom).
7. **A restrained glass finish.** The sticky header, the Personal Shopper, the overlays and the
   header menus use a translucent, blurred surface in both themes, opaque under
   `prefers-reduced-transparency: reduce`; Drop-in's fields stay on an opaque card and text keeps
   WCAG AA contrast.

## Consequences

- A session cookie (seven days) is no longer enough to pay in the chat after an hour: the shopper
  proves it again. Within the hour after a sign-in or a proof, a conversation pays within the
  grant's remaining budget without asking again, as a fresh one-click connect did before.
- The house agent keeps its grant across conversations: disconnecting it on `/account#agents` is
  how a shopper stops it, and the chat sees that at its next read.
- A card save that Adyen sends to a 3-D Secure page returns to `/account`, not to the chat; cards
  that need no challenge save inside the overlay.
- The Ask spec's earlier rule "a restart forgets a connection; ending a session revokes its grant"
  is replaced by points 1 and 2; its tests change with it.

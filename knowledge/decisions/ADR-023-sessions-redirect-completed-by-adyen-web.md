---
type: Decision
title: "ADR-023: Adyen Web completes a Sessions redirect"
description: "A Sessions redirect return is submitted by Adyen Web through the session (sessionId, submitDetails), per Adyen's guide; the server's /payments/details serves Advanced only and the order follows its webhook."
tags: [decision, sessions, redirect, adyen-web]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-28T11:30:00Z
sources:
  - id: redirect
    resource: ../../apps/adyen-digital/src/checkout/session-redirect.ts
    title: "completeSessionRedirect: AdyenCheckout from the sessionId, then submitDetails"
  - id: page
    resource: ../../apps/adyen-digital/src/components/workbench/RedirectReturn.tsx
    title: "The /result page: Sessions through Adyen Web, Advanced through the server"
  - id: route
    resource: ../../apps/adyen-digital/src/server/routes/advanced.ts
    title: "POST /api/digital/orders/:id/redirect-result, which refuses a Sessions order"
  - id: guide
    resource: https://docs.adyen.com/online-payments/build-your-integration/sessions-flow/
    title: "Adyen's Sessions flow guide, Handle the redirect"
---

# ADR-023: Adyen Web completes a Sessions redirect

**Context.** A redirect method (iDEAL, Klarna, a 3DS redirect with native 3DS off) sends the
shopper back to `/result`. Until 2026-11-28 the page posted the `redirectResult` to the server,
which called `/payments/details` for Sessions orders as well as Advanced ones and wrote the attempt
from the answer. Adyen's Sessions guide does it otherwise: the return URL carries `sessionId` and
`redirectResult`, and the front creates `AdyenCheckout` with that session id and calls
`checkout.submitDetails({ details: { redirectResult } })`; `onPaymentCompleted` or
`onPaymentFailed` then carries the `resultCode`, and the merchant's order waits for the webhook.
The owner asked to follow the guide (2026-11-28).

**Decision.**

- A return with a `sessionId` and a `redirectResult` is completed by Adyen Web
  (`checkout/session-redirect.ts`): the page shows the result from `onPaymentCompleted` or
  `onPaymentFailed`, and this server makes no `/payments/details` call for it.
- The order and its attempt follow the HMAC-valid AUTHORISATION webhook, as every other Sessions
  payment ([ADR-007](ADR-007-order-state-from-authoritative-events.md)).
- `POST /api/digital/orders/:id/redirect-result` serves Advanced only and answers 409 for a
  Sessions order (fail closed). Advanced keeps `/payments/details`.
- The `redirectResult` and `sessionId` leave the URL right before the submit, after the order and
  client-key checks (a failed check leaves them for a reload to retry), so a reload never submits
  them twice. The tab keeps Adyen Web's answer (Pending until it comes) in `sessionStorage` with
  the number of settled attempts it saw, and a reload shows it again: the order's last settled
  attempt may be an older refusal, not this payment. A settled attempt stored later is newer
  and wins, and the page polls while the answer is Pending or Received, on the return itself as on a reload.

**Consequences.** Locally, without a tunnel or a replay, a Sessions order paid by redirect stays
`open` after the return even though the page shows Authorised: no webhook arrives
([runbook](../operations/webhooks-without-a-tunnel.md)). The page needs the client key from
`/api/bootstrap`, and Adyen Web sets the session up from the `sessionData` it kept in its own
`localStorage` when the payment was made, so the shopper must come back in the same browser. A
Sessions return without a `sessionId` reaches the server route and is refused.

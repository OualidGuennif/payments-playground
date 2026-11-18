---
type: Decision
title: "ADR-016: A client assertion's aud may be the issuer or the token endpoint, against PAP 1.0"
description: "Owner, 2026-11-18: a private_key_jwt assertion's aud may be the issuer (with or without a final slash) or the exact token endpoint URL, so ChatGPT's MCP connector signs in; PAP 1.0 §4.1 allows only the issuer."
tags: [decision, agentic, oauth, pap, mcp, chatgpt, security]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-18T14:52:00Z
sources:
  - id: spec
    resource: ../components/adyen-agentic-commerce.md
    title: The store's spec (Inputs, invariant 23)
  - id: rfc7523
    resource: https://www.rfc-editor.org/rfc/rfc7523#section-3
    title: "RFC 7523 §3: aud identifies the authorization server; the token endpoint URL may be used"
  - id: oidc-core
    resource: https://openid.net/specs/openid-connect-core-1_0.html#ClientAuthentication
    title: "OpenID Connect Core §9: for private_key_jwt, aud SHOULD be the token endpoint URL"
  - id: rfc7523bis
    resource: https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc7523bis/
    title: "draft-ietf-oauth-rfc7523bis: aud is the issuer identifier, as a single string"
---

# ADR-016: A client assertion's aud may be the issuer or the token endpoint

**Status.** Accepted by the owner on 2026-11-18, in chat: "Vasy go sur le 1 stp", then "documente
bien à fond que du coup j'ai pris cette décision". It knowingly departs from PAP 1.0 §4.1. Revisit
under the conditions at the end.

## Context

The agentic store authenticates a PAP agent, and an MCP client known by a client metadata document
unless that document declares `token_endpoint_auth_method: none` (a public client, which sends no
assertion), with `private_key_jwt` (RFC 7523). Until v0.5.1 it accepted a client assertion only when
its `aud` was the issuer identifier (`https://agentic.payments-playground.com` on Render), as one
string. That is PAP 1.0 §4.1. PAP follows draft-ietf-oauth-rfc7523bis, which updates RFC 7523 after
the 2025 audience-injection findings:
- a client that builds `aud` from an endpoint URL in an authorization server's metadata can be led
  by a malicious authorization server to sign an assertion whose `aud` names an honest server's
  token endpoint, then send that assertion to the malicious server, which replays it at the honest
  one;
- the issuer cannot be spoofed that way, because RFC 8414 makes the client check the issuer against
  the metadata URL it fetched.

RFC 7523 §3 itself lets the token endpoint URL stand for the server, and OpenID Connect Core §9 says
that for `private_key_jwt` the `aud` SHOULD be the token endpoint URL, so most OAuth client
libraries put that URL there.

On 2026-11-18 the owner connected ChatGPT's MCP connector to the live store. The Back Office trace
shows two attempts before the decision:
1. 12:22:07 UTC: the shopper consented. 12:22:10: `POST /oauth/token` 401 `invalid_client`,
   "alg" not allowed. The store took only ES256 and PS384, and v0.5.1 (13:18 UTC) widened that to
   six asymmetric algorithms.
2. 13:25:19 UTC: the shopper consented again. 13:25:22: `POST /oauth/token` 401 `invalid_client`,
   "aud must be the issuer, as a single string". The signature now passed; the audience did not.

The refusal did not say which `aud` ChatGPT sent. The likely values are the token endpoint URL, the
issuer with a final slash, or an array. A third attempt, at 14:32:50 and 14:32:52 UTC, after the
decision but before v0.5.2 was deployed, met the same refusal.

## Options put to the owner

1. Accept, as one string, the issuer with or without a final slash, or this store's exact token
   endpoint URL; keep refusing an array and any other value; make the refusal name the `aud` it
   received. One release.
2. Diagnose first: change no rule, only name the received `aud` in the refusal, let ChatGPT retry,
   then accept that one value. Two releases.
3. Also accept an array that holds the issuer or the token endpoint. The widest, and the weakest.

Keeping PAP's rule as it is would leave ChatGPT unable to sign in. The owner chose option 1.

## Decision

`authenticateClient` (`apps/adyen-agentic-commerce/src/server/oauth.ts`) accepts a client
assertion whose `aud` is exactly one of these strings:
- the issuer, e.g. `https://agentic.payments-playground.com`;
- the issuer with one final slash, `https://agentic.payments-playground.com/`;
- the token endpoint, `https://agentic.payments-playground.com/oauth/token`.

The rule is the same wherever the store authenticates a client: the token endpoint, the revocation
endpoint and the device authorization endpoint. This is for compatibility: client libraries send
the token endpoint URL to all three. Accepting it only at the token endpoint would refuse an
injected assertion at the other two, where the harm is smallest (see Consequences), and would break
those clients there.

Still refused, each as 401 `invalid_client`:
- an array, even one holding only the issuer;
- any other endpoint (`/oauth/revoke`, `/mcp`, the token endpoint with a final slash);
- another host or scheme;
- a missing `aud`.

The refusal now names the `aud` received, truncated to 200 characters, with every character
outside printable ASCII, every `"` and every `\` replaced by `?`, or says "no aud". The echoed
value is untrusted text: whatever the client put in its assertion, which in an audience-injection
case another authorization server's metadata steered. It holds no secret of the store's, it is
capped and sanitised as above, and it lets the next failure be read in the trace instead of
guessed. A successful token request's trace row names which accepted form was used
(`audience`: "issuer", "issuer with slash" or "token endpoint"), so the form ChatGPT sends is
known once it signs in.

Nothing else changes:
- the signature, `iss` = `sub` = `client_id`, `iat`, `jti` (single use), the 300 s lifetime and the
  60 s skew;
- the Poppy-Session's `aud`, which stays the issuer alone;
- the metadata, since RFC 8414 has no field for accepted audiences.

## Consequences

- ChatGPT's MCP connector, and any client library that follows OpenID Connect Core, can get a token
  without a change on its side, as long as it sends one of the three strings.
- The store is no longer strictly PAP 1.0 conformant on this point. A PAP agent loses nothing: it
  sends the issuer, which is still accepted. A PAP conformance suite that sends the token endpoint
  as `aud` and expects a refusal would now see a 200. The spec (Inputs, invariant 23) and
  `docs/KNOWN_LIMITS.md` say so.
- **Residual risk: audience injection against a client.** Take a client tricked by a malicious
  authorization server into signing an assertion with `aud` = this store's token endpoint. The
  attacker can replay that assertion here once (`jti` is single use) within its lifetime (at most
  300 s). Client authentication alone gives little here:
  - the store has no `client_credentials` grant;
  - an authorization code also needs the PKCE verifier and the client's `redirect_uri`;
  - a refresh needs the refresh token;
  - a device sign-in only starts if the client's own document declares the device grant, a shopper
    still has to approve it on the device page, and every poll needs a further assertion;
  - revocation only touches the client's own tokens.
  The risk falls on that client's sign-ins at this store, never on another client or account.
- **What we did not do.** No array is accepted: it is the case rfc7523bis singles out. No other
  path is accepted, so a client that confuses endpoints still fails loudly.

## Verified

v0.5.2 was deployed at 14:46:56 UTC on 2026-11-18. At 14:47:18 the shopper consented to ChatGPT
again, and at 14:47:25 its `POST /oauth/token` answered 200 with `audience` "token endpoint" in the
trace. ChatGPT's MCP connector therefore sends the token endpoint URL as `aud`: accepting the issuer
with a final slash alone would not have been enough. It then shopped over `/mcp` (14:49 to 14:50:
`search_catalog`, `create_checkout`, `complete_checkout` with the `network_token` handler,
`get_order`). Adyen TEST answered `/payments` `Authorised` (`PRFVNF6K9MV5MNV5`, Visa, 149.00 EUR),
and an HMAC-valid `AUTHORISATION` webhook followed. Order `ord_W7sDVFQPO47F` is `authorised` in the
agent channel.

## Revisit when

- ChatGPT's connector stops sending the token endpoint URL as `aud` (the trace's `audience` on its
  token requests shows it); accepting the token endpoint could then be withdrawn, by a new
  decision, not a silent edit;
- draft-ietf-oauth-rfc7523bis becomes an RFC, or PAP publishes a version that allows or forbids the
  token endpoint explicitly;
- a client is seen replaying an assertion signed for another server.

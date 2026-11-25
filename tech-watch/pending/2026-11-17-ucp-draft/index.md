# UCP draft after 2026-08-25: what it asks of the agentic store

- **Baseline:** `develop` at `9741eb1` (clean tree), cutoff 2026-11-17. The store speaks UCP
  2026-08-25 (`apps/adyen-agentic-commerce`, `UCP_VERSION`).
- **Scope:** the UCP draft on `main` of `github.com/Universal-Commerce-Protocol/ucp` at `32a52e9`
  (2026-11-16), compared with the tag `v2026-08-25`: 56 commits, schemas under `source/schemas`
  and the normative lines (MUST, SHOULD, MAY) of `docs/specification`. New verticals (food,
  lodging) and new extensions were listed, not read in full.
- **Sources:** that repository, retrieved 2026-11-17 by `git fetch` and `git diff`. Kind:
  documented draft text, not a released version; nothing here is binding until UCP cuts a
  version. Depth: every schema diff touching cart, checkout, item, product, variant and `ucp.json`;
  the normative lines of overview, identity linking, checkout, cart, order and catalog.
- **Not inspected:** the draft's conformance suite, and whether a version cut is scheduled.

## Items

| ID | Priority | State | Smallest next action and acceptance | Detail | Resolution evidence |
| -- | -------- | ----- | ----------------------------------- | ------ | ------------------- |
| W1 | P2 | IMPLEMENTED | A `cart_id` checkout takes the cart's lines and buyer. | Already a 2026-08-25 MUST (cart extension: "use the cart contents", ignore overlapping fields); the draft restates it (#940). Observed: `line_items` sent with `cart_id` replaced the cart. | `9741eb1`; `src/server/ucp/ucp.test.ts` "cart to checkout". |
| W2 | P2 | OPEN | When UCP cuts the next version: refuse `cart_id` unless the cart capability was negotiated; a catalog-and-checkout-only profile sending `cart_id` gets an error, test in `src/server/ucp/profile.test.ts`. | Draft-only MUST (#940, `shopping/checkout/index.md`). Needs the negotiated set passed from `protocol.ts` to `createCheckout`. Today the store honours `cart_id` under any profile that reaches checkout. | |
| W3 | P3 | OPEN | Re-validate the captured v0.3.3 answers with ucp-schema 2.x once the owner approves that version; acceptance: every capture still Valid. | The draft's docs moved to ucp-schema 2.0.0 (#887, #982). The v0.3.3 captures were validated with 1.4.1, the version approved. | |
| W4 | P3 | OPEN | When the next version is cut: plan the move as its own task, with this diff as the starting point (owner decision). | The store negotiates 2026-08-25 only and answers `version_unsupported` otherwise. | |

## Designs kept unchanged

- **Profile fetch and `304`:** the draft now says a `304 Not Modified` answer to a conditional
  request is not a forbidden redirect (#933). The store never sends a conditional request, so a
  `304` cannot be a valid answer to it and stays `profile_unreachable`. Revalidating an expired
  profile with `If-None-Match` would only save bandwidth; not worth it here.
- **`list_price`** (#1016): optional, response-only. The demo catalogue has no reference price, so
  the store sends none; the draft forbids reporting the gap as a discount, which it would not do.
- **`line_items` optional with `cart_id`** (#940): the store already accepts a `cart_id` alone.
- **Identity linking** (#891, #998, the JWT grant single-use bullet): the store lists only itself
  in `authorization_servers`, offers no JWT grant and does no email matching; nothing to change.
- **Order webhooks** (#659, a breaking draft change to the signing gate): the store sends none
  (out of scope in its spec).

## Rejected for this store

New capabilities and extensions with no use in a one-shop demo: `ask` (#538), purchase options
and subscription policy (#890), return policy (#634), Food Checkout (#897) and lodging booking.

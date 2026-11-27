---
type: Component
title: "Agentic storefront: the flagship pages, the 30-piece catalogue, its OpenAI product feed and the Personal Shopper's place on the page"
description: "The human face of the agentic store: catalogue data, product feed, header and Developers menu, GSAP motion, cart and unified checkout, and the Personal Shopper rail and sheet (ADR-019)."
tags: [component, agentic, storefront, catalog, feed, gsap, checkout]
status: draft
scope: component-agentic-storefront
generated:
  by: claude-code/opus-5.5
  at: 2026-11-26T23:40:00Z
sources:
  - id: adr
    resource: ../decisions/ADR-019-flagship-storefront.md
    title: "ADR-019: why the flagship storefront, the feed, GSAP and the inline Personal Shopper"
  - id: store
    resource: ./adyen-agentic-commerce.md
    title: "The store's spec: UCP, MCP, PAP, accounts, payments (unchanged by this doc)"
  - id: ask
    resource: ./ask-agent.md
    title: "The Ask agent's spec: the chat behind the Personal Shopper"
  - id: products
    resource: ../../apps/adyen-agentic-commerce/src/server/catalog/products.ts
    title: "The catalogue data: 30 products, colours, sizes, feed attributes"
  - id: openai-feed
    resource: https://developers.openai.com/commerce/specs/feed
    title: "OpenAI: product feed schema (read 2026-11-27)"
---

# Agentic storefront

## Intent

The store a person sees at `agentic.payments-playground.com`: a modern editorial fashion
storefront where a shopper browses, asks the Personal Shopper, and pays on Adyen TEST without
being asked twice who they are. Agents keep using UCP, MCP and PAP exactly as before
([store spec](adyen-agentic-commerce.md)); they get the richer catalogue for free. Owner decision
2026-11-27 ([ADR-019](../decisions/ADR-019-flagship-storefront.md)).

## Data sources

| Source                                  | What is read                                                | Owner | Freshness          |
| --------------------------------------- | ----------------------------------------------------------- | ----- | ------------------ |
| `src/server/catalog/products.ts`        | 30 products: ids, colours, sizes, prices, feed attributes   | Repo  | Shipped with build |
| `src/server/catalog/art.ts`             | One original SVG drawing per product shape and colour       | Repo  | Shipped with build |
| The site session and the Ask session    | Signed in or not, the account email, an agent connection    | App   | Per request        |

## Inputs

- **Shopper:** category, search and filter choices; colour and size; bag edits; delivery choice;
  an email when paying as a guest; Drop-in; the Personal Shopper's messages and one-click budget.
- **Feed reader:** `GET /api/feeds/openai.json` and `GET /api/feeds/openai.jsonl`, no credentials.

## Outputs and refusals

- **Catalogue:** five categories in this order: clothing, footwear, bags, accessories, essentials
  (9, 5, 6, 6 and 4 pieces). Every product has a subtitle, a description of two or three
  sentences, material, care, fit, origin, three highlights, gender, weight in grams, packed
  dimensions in centimetres and a demo rating with a review count, shown as demo data. A markdown
  keeps the paid price in `price` and the earlier one in `compareAt`. Pictures are the SVG drawings
  at `/api/art/<variant>.svg`.
- **Product feed:** one row per variant with the spec's current names: `item_id` (the variant id),
  `group_id` (the product id), `listing_has_variations`, `variant_dict` (colour and size), `title`,
  `description`, `url`, `brand`, `seller_name`, `seller_url`, `image_url`,
  `additional_image_urls`, `availability` (`in_stock` or `out_of_stock`), `price` and, for a
  markdown, `sale_price` as "amount EUR", `gtin` (a valid EAN-13 in the 200 to 299 in-store range),
  `mpn`, `condition`, `product_category`, `color`, `size`, `size_system` (EU), `gender`,
  `age_group`, `material`, `pattern`, `weight` with `item_weight_unit`, `dimensions`,
  `target_countries` and `store_country` (FR), `shipping_price`, `accepts_returns`,
  `return_deadline_in_days` (30), `return_policy`, `review_count`, `star_rating`,
  `is_eligible_search`, `is_eligible_checkout`, `seller_privacy_policy` and `seller_tos`.
  JSON answers `{ "items": [...] }`; JSONL one row per line. Both are public and cacheable for 300 s.
- **Header:** a thin TEST bar; the wordmark; the categories; on the right the Personal Shopper, a
  Developers menu (Connect an agent, Docs, Back Office, OpenAI product feed, Agent console), the bag
  with its count, the account and the theme switch.
- **Cart and checkout:** no demo email is ever prefilled. Checkout shows contact, delivery and
  payment together; a signed-in shopper sees their email as verified, a guest types one, and Pay
  with a missing or invalid email marks the field, focuses it and pays once it is valid.
- **Personal Shopper:** the Ask panel under its new name, a rail at 1024 px and wider, a bottom
  sheet below; it reads the site session as soon as it changes.

## Invariants

1. The 13 product ids and their variant ids that existed before ADR-019 stay. Test:
   `src/server/ucp/ucp-shapes.test.ts` "search pages ten by default and its cursor walks the rest
   once" (every product listed once across pages).
2. Category filters on MCP, UCP REST and WebMCP accept the five categories. Tests:
   `src/server/ucp/identity.test.ts` "search reads UCP's categories (any of) and price range; the
   old category still works"; `src/lib/webmcp.test.ts` "search returns compact products within
   1.5K, filtered like the shop".
3. Motion never runs under `prefers-reduced-motion: reduce`.
4. A signed-in shopper is never asked to sign in or for an email by the cart, the checkout or the
   Personal Shopper.
5. Ratings and review counts are labelled demo data wherever a person reads them.

## Determinism

The catalogue and the feed are pure functions of the build and `PUBLIC_ORIGIN`.

## Acceptance checks

- `bun run check` green; the invariants' tests pass.
- In a browser at 375 and 1440 px, light and dark: home, shop, a product page, cart and checkout
  read cleanly; a guest pressing Pay with no email is taken to the field; a signed-in shopper is
  never asked who they are.

## Out of scope

Photographs (the SVG drawings stay until real pictures exist); `apps/adyen-digital`,
`apps/adyen-v6-styling` and `apps/landing`; any change to the agent protocols' contracts.

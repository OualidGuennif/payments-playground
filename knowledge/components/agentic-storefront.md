---
type: Component
title: "Agentic storefront: the flagship pages, the 30-piece catalogue, its OpenAI product feed and the Personal Shopper's place on the page"
description: "The human face of the agentic store: catalogue data, product feed, header and Developers menu, GSAP motion, cart and unified checkout, and the Personal Shopper rail and sheet (ADR-019)."
tags: [component, agentic, storefront, catalog, feed, gsap, checkout]
status: draft
scope: component-agentic-storefront
generated:
  by: claude-code/opus-5.5
  at: 2026-11-27T08:55:00Z
sources:
  - id: adr
    resource: ../decisions/ADR-019-flagship-storefront.md
    title: "ADR-019: why the flagship storefront, the feed, GSAP and the inline Personal Shopper"
  - id: adr-020
    resource: ../decisions/ADR-020-pay-identity-welcome-offer-and-seasons.md
    title: "ADR-020: the Pay email modal and its email check, the first-order welcome offer, seasons a month early"
  - id: store
    resource: ./adyen-agentic-commerce.md
    title: "The store's spec: UCP, MCP, PAP, accounts, payments (unchanged by this doc)"
  - id: ask
    resource: ./ask-agent.md
    title: "The Ask agent's spec: the chat behind the Personal Shopper"
  - id: catalog
    resource: ../../apps/adyen-agentic-commerce/src/server/catalog
    title: "The catalogue data (products.ts: 30 products, colours, sizes, feed attributes) and the OpenAI feed (openai-feed.ts)"
  - id: pages
    resource: ../../apps/adyen-agentic-commerce/src/app/page.tsx
    title: "The home page"
  - id: shop
    resource: ../../apps/adyen-agentic-commerce/src/app/shop
    title: "The shop page (filters in components/shop/ShopBrowser.tsx)"
  - id: product
    resource: ../../apps/adyen-agentic-commerce/src/app/products
    title: "The product page"
  - id: components
    resource: ../../apps/adyen-agentic-commerce/src/components
    title: "Storefront components: ProductCard, VariantPicker, DevelopersMenu, ThemeSwitch, shop/, motion/ (GSAP)"
  - id: developer-links
    resource: ../../apps/adyen-agentic-commerce/src/lib/developerLinks.ts
    title: "The Developers menu's links, shared by the header and the mobile menu"
  - id: theme
    resource: ../../apps/adyen-agentic-commerce/src/lib/theme.ts
    title: "The theme's storage key and the head script that applies it before first paint"
  - id: welcome-offer-tests
    resource: ../../apps/adyen-agentic-commerce/src/server/commerce/welcome-offer.test.ts
    title: "The welcome offer's tests: eligibility, amounts, the claim's refusals, the tote's pictures"
  - id: seasons
    resource: ../../apps/adyen-agentic-commerce/src/lib/seasons.ts
    title: "The season of a UTC date: its tote, its top bar line, its ambience"
  - id: test-cards
    resource: ../../apps/adyen-agentic-commerce/src/lib/testCards.ts
    title: "The Adyen TEST cards shown beside Drop-in on the checkout"
  - id: openai-feed
    resource: https://developers.openai.com/commerce/specs/feed
    title: "OpenAI: product feed schema (read 2026-11-27)"
verified:
  - at: 2026-11-27
    check: "Local (127.0.0.1:8003, TEST): a guest checkout paid with Adyen's TEST Visa, Authorised (WF5LWXPHDFWRSV75); Pay with no email marked, centred and focused the field; rail 440 px with Ctrl+K at 1440, sheet 447/812 px at 375, light and dark, no overflow."
  - at: 2026-11-27
    check: "Prod v0.10.1, signed out: feed 188 JSON rows and JSONL lines; home, shop filter, product page, bag gauge; guest Pay with no email marked and focused the field; rail 440 px with Ctrl+K at 1440; sheet 447/812 px, minimised on a product page, at 375. No payment, no signed-in check."
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
| `src/lib/seasons.ts` and the clock (UTC) | The season: its tote, top bar line and ambience            | Repo  | Per request        |
| The store's orders                      | Whether an account has ordered (welcome offer)              | App   | Per request        |
| The site session and the Ask session    | Signed in or not, the account email, an agent connection    | App   | Per request        |

## Inputs

- **Shopper:** category, search and filter choices; colour and size; bag edits; delivery choice;
  in the Pay email modal an email, then a password (sign in or a new account) or Pay as guest, and
  the welcome offer; Drop-in; the Personal Shopper's messages and one-click budget.
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
  `description`, `url`, `brand`, `seller_name`, `seller_url`, `image_url` (the SVG drawing; the
  spec's examples are JPEG and PNG, so a reader that wants a photograph gets none), `availability`
  (`in_stock` or `out_of_stock`), `price` as "amount EUR" (the price before a markdown when there is
  one, with `sale_price` the paid price), `gtin` (a valid EAN-13 in GS1's 200 to 299 in-store
  range, stable per variant id), `mpn`, `condition`, `product_category`, `color`, `size`,
  `size_system` (EU, absent for one size), `gender`, `age_group`, `material`, `pattern`, `weight`
  with `item_weight_unit` (g), `dimensions` (cm), `target_countries` and `store_country` (FR),
  `shipping_price` (standard delivery, free from 100 EUR), `accepts_returns`,
  `return_deadline_in_days` (30), `return_policy` (`/legal#returns`), `review_count`,
  `star_rating`, `is_eligible_search`, `is_eligible_checkout`, `seller_privacy_policy` and
  `seller_tos`. No `additional_image_urls`: each variant has one drawing. JSON answers
  `{ "items": [...] }`; JSONL one row per line. Both are public and cacheable for 300 s.
- **Header:** a slim seasonal sandbox bar ("Winter Edition · Agentic Commerce Sandbox · 5% off &
  free Winter Tote on your first order"; its first two parts under 640 px); the wordmark (ATELIER
  VELUNE, VELUNE under 640 px); New and the five departments from 1280 px; on the right the
  Personal Shopper, a Developers menu from 1024 px (Connect an agent, Technical docs, Back Office,
  OpenAI product feed, Agent console), the theme switch (system, light, dark, kept in
  `localStorage` and applied by a head script before the first paint), the bag with its count,
  and Sign in or the account's initial on every width (it follows `velune:auth-changed` at once).
  Below 1280 px the Menu holds the departments, the Developers links and the theme, never the
  account. Header items never wrap onto a second line. The Adyen TEST notice stays on the
  checkout, `/legal` and the footer.
- **Home:** a hero (GSAP), five department tiles, New and trending (badged pieces, New first), a
  Personal Shopper section whose prompts open the panel with the question in its composer (never
  sent by itself), and a "Built for humans and AI agents" band (MCP address, feed links).
- **Shop:** every filter applies in the browser as the shopper taps or types (department, New in,
  for women or men, price band, on sale, colour, size; sort featured, new, price, rating) and the
  address follows (`/shop?category=…&q=…` and the rest), so links and the Personal Shopper's
  `open_page` open the same view; 2 columns, 3 from 768 px, 4 from 1280 px; under 1024 px the
  filters are a bottom sheet. A card says "1 colour" or "N colours"; tapping or hovering one of
  its swatches shows that colour's picture and points the card's link at that variant.
- **Product page:** sticky picture with colour thumbnails, badge, demo rating labelled "(demo
  data)", price with the struck earlier price on a markdown, colour swatches, a size grid, Add to
  bag, "Ask your Personal Shopper about this piece", folds (details, material and care, fit,
  delivery and returns), an "OpenAI feed & UCP data" fold with the variant's UCP id and feed row,
  and Complete the look (the best-rated piece of up to four other departments that suits the same
  shopper). Opening a fold never widens the page: both columns may shrink (`min-w-0`) and the feed
  row scrolls inside its box.
- **Bag:** two columns from 1024 px (lines, then a sticky summary); each line has its drawing,
  colour and size, a quantity stepper (1 to 10) and Remove; the summary shows how far the bag is
  from free standard delivery (`FREE_SHIPPING_FROM`, the server's own threshold), the subtotal and
  an estimated total with standard delivery. It asks for no email and sends none.
- **Checkout:** the title, then two columns from 1024 px: the steps Contact, Delivery and Payment,
  and a sticky order summary (above the steps on a phone). A signed-in shopper's receipt goes to
  their account email, labelled "Your account", and they are never asked for one; an account with
  no order yet may apply the welcome offer in one tap. A guest reads "Guest or account: we ask for
  your email when you pay" (with "Add email now") and a "Pay €X" button; Pay with no email opens
  the Pay email modal, and once it resolves Drop-in opens and scrolls into view. The summary shows
  a welcome offer as a green "Welcome offer (-5%)" row and the free tote line with its picture.
  Below Drop-in, four Adyen TEST cards (`src/lib/testCards.ts`, the values of
  `packages/ui/testData.ts`) copy without spaces.
- **Pay email modal** (`PayIdentityModal`, on `/checkout` and over the Personal Shopper): "Add your
  email address", one field and Continue, then the email check below. An account's email shows
  "Welcome back" with the email and Change, a password ("Sign in & continue to payment") or a
  passkey; the checkout is then claimed for the account with the welcome offer asked (the store
  grants it to a first order only), and the header and the Personal Shopper follow at once
  (`velune:auth-changed`); "Continue as guest instead" stays. A new email offers "Create an
  account & get 5% off" (name optional, a password of 12 to 128 characters, the saving, the
  seasonal tote's picture and the new total shown) or "Pay as guest" (the standard total, no
  account). A guest email goes through `POST /api/checkouts/:id/email`, set once. When the check
  answers 429, the modal offers Pay as guest and Sign in. A centred card from 640 px, a bottom
  sheet below; Escape and the backdrop close it, focus stays inside, 16 px fields on touch screens.
  Its backdrop, the filters sheet's and the Personal Shopper sheet's darken the page in both themes
  (`--color-scrim`: the ink in light, black in dark, where the ink turns light).
- **Email check** `POST /api/session/check-email` `{ email }`: another site (the proxy, then
  `Origin` and `Sec-Fetch-Site` read again) or no `X-Velune-Check: 1` gets 403 `forbidden`; 15
  calls per client address per 15 minutes, counted before the body is read (429 `rate_limited`
  with `Retry-After`); 400 `invalid_email` for a malformed address; else 200 `{ "exists": boolean
  }` with nothing more, `Cache-Control: no-store`, never sooner than 45 ms after it began. The
  trace keeps the email masked. Sign-in keeps one refusal, "Wrong email or password".
- **Welcome offer:** `POST /api/checkouts/:id/claim` `{ applyWelcomeOffer?: boolean }` (signed in,
  else 401 `sign_in_required`; another key 400 `invalid_request`) binds an open checkout to the
  signed-in customer and their email (another customer's: 404 `not_found`; paid, closed or being
  paid: 409). With `applyWelcomeOffer` and no order on the account, the checkout takes the season's
  offer: 5 % off the item subtotal (rounded to the cent) and a "{Season} Tote Bag Edition" line at
  €0.00; the answer says `welcomeOfferApplied`. `POST /api/checkouts` takes the same flag for a
  signed-in shopper. Free delivery is judged on the subtotal before the discount. The payment
  session checks again: an account that has ordered since loses the offer and the session is
  refused (409 `welcome_offer_ineligible`), so the page shows the new total before paying. The
  payment record and the order keep the offer, and the order's amount check prices with it. The
  checkout, the order page, the account's orders, UCP answers (a negative `discount` total and the
  tote line at 0) and the Back Office show it; `GET /api/account` says `firstOrderEligible`. The
  tote's picture is `/api/art/velune-welcome-tote-<season>.svg` (four names, any other 404); it is
  no catalogue product, feed row or id an order can name.
- **Seasons** (`src/lib/seasons.ts`, UTC): winter from 21 November, spring from 21 February, summer
  from 21 May, autumn from 21 August, each to the 20th before the next. The layout reads the season
  per request; it names the tote and the top bar, and a faint ambience (`SeasonalAmbience`: 16
  particles, 10 under 640 px, CSS keyframes only, opacity 0.12 to 0.24, no pointer events, light
  and dark) draws it. Reduced motion hides it.
- **Layers:** the ambience `z-10`, the minimised Personal Shopper `z-30`, the header and its menus
  `z-40`, the open Personal Shopper `z-50`, the Pay email modal `z-[60]`. Opening the Personal
  Shopper closes the header's menus (`velune:close-menus`); opening the Menu or the account menu on
  a phone minimises an open Personal Shopper.
- **Personal Shopper:** the Ask panel under its new name: a 440 px rail from 1024 px, a sheet of
  55 or 92 % of the screen below, Cmd/Ctrl+K, a header line and three questions per kind of page,
  the bag's count, and the widget with its delivery block as one card; Pay with no email opens the
  Pay email modal over it; it reads the site session as soon as it changes and steps aside on a
  phone when a product or checkout page opens ([Ask spec](ask-agent.md), Panel).

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
   Personal Shopper. Tests: `src/server/ask/agent.test.ts` "a signed-in shopper is never sent to a
   sign-in form", "a signed-in shopper's receipt email"; `src/server/ask/api.test.ts` "a signed-in
   shopper's checkout carries their account email from the start, masked".
5. Ratings and review counts are labelled demo data wherever a person reads them.
6. The feed has one row per variant, unique ids, valid and unique EAN-13s in the 200 range, the
   spec's names and money format, and the same rows in JSON and JSONL. Tests:
   `src/server/catalog/openai-feed.test.ts` (six tests).
7. The shop's filters keep only matching pieces, split prices into bands that cover every piece
   once, read a plural search word as its singular and sort without reordering the catalogue.
   Tests: `src/components/shop/filter.test.ts` (seven tests).
8. The checkout's test cards are Adyen's published TEST numbers, the same values as the suite's
   shared list. Test: `packages/ui/testData.test.ts` (outside the app: its image carries no
   package source, and `src/selfContained.test.ts` refuses an import that leaves the app).
9. A season starts on the 21st of November, February, May and August (UTC), leap days included.
   Test: `src/lib/seasons.test.ts` (three tests).
10. The email check answers `{ "exists": boolean }` only, and only to the store's own pages, with
    the header, under its limit and with a valid email; its trace never holds the email; the modal
    picks no path on an unclear answer. Tests: `src/server/accounts/customers.test.ts` "the email
    check" (four tests); `src/components/payIdentity.test.ts` (three tests).
11. The welcome offer is asked for, never applied by itself; it goes to an account with no order,
    once, priced on the server and checked again before the payment session; the payment's amount
    is the discounted total. A checkout without it keeps its catalogue prices and three totals.
    Tests: `src/server/commerce/welcome-offer.test.ts`; the UCP and checkout price tests unchanged.
12. A guest's email stays set once: a second `POST /api/checkouts/:id/email` is 409 `email_set`.
    Test: `src/server/accounts/customers.test.ts` "a checkout handed over without an email takes
    one at its link, once" (unchanged).

## Determinism

The catalogue and the feed are pure functions of the build and `PUBLIC_ORIGIN`.

## Acceptance checks

- `bun run check` green; the invariants' tests pass.
- In a browser at 375 and 1440 px, light and dark: home, shop, a product page, cart and checkout
  read cleanly; a signed-in shopper is never asked who they are.
- At 1440x900 and 390x844, light, dark and reduced motion: the seasonal bar, Sign in in the header,
  the Menu above the minimised Personal Shopper, the header on one line with the rail docked, the
  ambience faint and absent under reduced motion, a product fold that leaves the page's width.
- Pay with no email, on `/checkout` and in the Personal Shopper: an account's email signs in and
  Drop-in opens; a new email creates an account and pays the discounted total with the tote on
  the order, and a second order gets no offer; Pay as guest opens Drop-in at the standard total.
- `/sign-up` with an email that has an account offers "Sign in as" with the email prefilled; in
  dark mode an autofilled field stays dark.

## Out of scope

Photographs (the SVG drawings stay until real pictures exist); `apps/adyen-digital`,
`apps/adyen-v6-styling` and `apps/landing`; any change to the agent protocols' contracts.

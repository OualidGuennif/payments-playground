---
type: Component
title: "MCP Apps widgets: the agentic store's carousel and bag inside an agent host, and its plugin"
description: "The product carousel and the bag the agentic store serves as MCP Apps UI resources, rendered inside ChatGPT, Claude or the store's Ask panel, their bridge, and the plugin ZIP."
tags: [component, agentic, mcp, mcp-apps, widgets, chatgpt, plugin]
status: draft
scope: component-mcp-apps-widgets
generated:
  by: claude-code/opus-5.5
  at: 2026-11-25T18:00:00Z
sources:
  - id: store
    resource: ./adyen-agentic-commerce.md
    title: "The store's spec: UCP tools, grants, checkout and payment these widgets call"
  - id: adr
    resource: ../decisions/ADR-017-mcp-apps-ui-on-the-ucp-server.md
    title: "ADR-017: MCP Apps UI on the UCP server"
  - id: widgets
    resource: ../../apps/adyen-agentic-commerce/src/widgets
    title: "The widgets' source: app, logic, bridge, CSS"
  - id: resources
    resource: ../../apps/adyen-agentic-commerce/src/server/mcp/widgets.ts
    title: "The UI resources and prompts served on /mcp"
  - id: plugin
    resource: ../../apps/adyen-agentic-commerce/plugin/atelier-velune
    title: "The plugin package served as a ZIP"
---

# MCP Apps widgets

Split out of the [store's spec](adyen-agentic-commerce.md) on 2026-11-25 so each stays under the
600-line cap. The store's invariants 28 to 30 are invariants 1 to 3 here; tests that cite "28 to
30" mean these.

## Intent

A shopper who talks to an AI agent in a host that renders MCP Apps (ChatGPT, Claude, or the store's
own Ask panel) sees the store's product carousel and bag inside the conversation and can tap
instead of typing. The widgets are a view and a remote control for the shopper's own grant: they
hold no token, no card data and no authority the agent does not already have.

## Data sources

- The store's UCP tools on `/mcp` (search, lookup, product, cart, checkout, saved cards,
  `complete_checkout`), called through the host on the shopper's grant.
- The store's catalogue images, from `PUBLIC_ORIGIN` or inlined by the Ask panel as `data:image/`.

## Inputs

- **Shopper in an agent host's UI ([ADR-017](../decisions/ADR-017-mcp-apps-ui-on-the-ucp-server.md)):**
  the host shows the product carousel or the bag inside the conversation. Its buttons call the UCP
  tools through the host themselves (search, next page, add to bag, quantities, checkout, pay with
  a listed saved card); it never writes to the assistant. Every call is the host's `tools/call` on
  the shopper's grant; the widget holds no token and no card data, and from the host's first
  message on it posts to the host's origin only (keeping `"*"` for the handshake and for an opaque
  `"null"` host origin). It shows the store's refusals in its own plain words for the codes it
  knows ("The store needs an email for the receipt." for `missing_buyer_email`, which the store's
  checkout page or the Ask panel asks for), and the store's text for any other.

## Outputs

- **MCP Apps UI:** `initialize` announces `resources`, `prompts` and boutique stylist instructions;
  `prompts/list` and `prompts/get` serve `personal-stylist`. `resources/list` serves
  `ui://widget/product-carousel-v2.html` and `ui://widget/cart-checkout-v2.html`
  (`text/html;profile=mcp-app`, inline script and style; `resources/read` keeps v1 aliases; unknown
  URI `-32002`), with `_meta.ui.csp` images from `PUBLIC_ORIGIN` only and `openai/widgetCSP` adding
  that origin to `redirect_domains`. A widget links only to `PUBLIC_ORIGIN` and draws an image
  only from it or from a `data:image/` URL (PNG, JPEG, WebP, GIF or SVG), the form in which the
  Ask panel hands it the store's own images. `search_catalog` and `get_product` name the carousel;
  cart and checkout tools (`complete_checkout` included) name the bag (`_meta.ui.resourceUri`,
  alias `openai/outputTemplate`, `ui.visibility` `["model","app"]`, `openai/widgetAccessible`,
  `openai/toolInvocation`). `bridge.ts` deduplicates host payloads, ignores stale
  `openai:set_globals` after `ui/initialize`, keeps updates silent via `setWidgetState` in ChatGPT
  and structured `ui/update-model-context` elsewhere, and falls back on `openExternal`. The bag
  offers "Save a test card" and "Refresh cards" when no saved card is present. `complete_checkout`
  is destructive and open-world, cancel tools destructive. `src/widgets/` builds into
  `src/server/mcp/widgets.gen.ts` with a source hash check.
- **Plugin package:** `GET /downloads/atelier-velune-plugin.zip` packages `plugin/atelier-velune/`
  (`plugin.json` meeting OpenAI listing limits, `mcp.json` with Agent Plugins `$schema`,
  `${PUBLIC_ORIGIN}/mcp` and `extensions["com.openai"].auth` CIMD, `personal-stylist` skill,
  icons), without hooks or app references; `/docs/chatgpt` explains direct MCP vs ZIP import.
- **Refusals:** a widget never shows a raw code; the store's payment lock (`payment_in_progress`)
  reads as "A payment for this bag is already in progress."

## Invariants

1. (Store 28.) The UI resources (v2 URIs and v1 aliases) answer where `tools/list` does, load
   nothing outside `PUBLIC_ORIGIN`, match their sources' hash, and serve
   `prompts/list`/`prompts/get` (`src/server/mcp/widgets.test.ts`).
2. (Store 29.) A widget has no authority: its buttons call UCP tools (named `saved_card`,
   single-attempt idempotency keys, extending the open bag) and never send the assistant a
   message, and the bridge pins parent origin and suppresses stale host `toolOutput` / composer
   text (`src/widgets/logic.test.ts`, `src/server/mcp/widgets.test.ts`, `src/widgets/bridge.test.ts`).
3. (Store 30.) The plugin ZIP holds its listed files, `$schema`, `${PUBLIC_ORIGIN}/mcp`, OpenAI
   OAuth CIMD and valid listing fields, with no app reference or hook
   (`src/server/mcp/plugin.test.ts`).

## Determinism

No model runs in a widget. Its view is a pure function of the last tool result it was handed
(`src/widgets/logic.ts`); its buttons map one tap to one tool call.

## Acceptance checks

- Both widgets in a browser inside a stand-in host (both bridges, both modes, 375 and 1440 px,
  light and dark); in ChatGPT, the owner's own account: the carousel renders, a by-hand "Add to
  bag", and a saved-card payment after the host's confirmation.
- In the Ask panel: one frame per conversation, product pictures as `data:image/` URLs.

## Out of scope

- A widget that pays without the host's confirmation, or holds a card or a token.
- Hooks or app references in the plugin package.

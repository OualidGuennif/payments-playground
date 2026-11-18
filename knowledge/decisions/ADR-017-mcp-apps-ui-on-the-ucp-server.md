---
type: Decision
title: "ADR-017: MCP Apps UI on the UCP MCP server, with a by-hand and an assistant mode"
description: "Owner, 2026-11-18: the agentic store's MCP server serves a product carousel and a bag as MCP Apps resources on its UCP tools; the widgets hold no authority, offer a by-hand and an assistant mode, and ship with a downloadable plugin package."
tags: [decision, agentic, mcp, ucp, pap, chatgpt, ui]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-18T21:10:00Z
sources:
  - id: spec
    resource: ../components/adyen-agentic-commerce.md
    title: The store's spec (Inputs, Outputs, invariants 28 to 30)
  - id: mcp-apps-chatgpt
    resource: https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
    title: "OpenAI: Add UI to your MCP server (MCP Apps in ChatGPT, commerce rules)"
  - id: plugin-reference
    resource: https://developers.openai.com/plugins/reference
    title: "OpenAI: tool and resource _meta, window.openai, annotations"
  - id: plugin-submission
    resource: https://developers.openai.com/plugins/deploy/submission
    title: "OpenAI: plugin ZIP upload and its restrictions"
  - id: plugin-build
    resource: https://developers.openai.com/codex/plugins/build
    title: "OpenAI: plugin.json, mcp.json and local installation"
---

# ADR-017: MCP Apps UI on the UCP MCP server

**Status.** Accepted by the owner on 2026-11-18, in chat, after a plan with four recommended
answers: "Vasy go pour les 4 trucs recommandé mais affiches 2 mode possible", that is, the shopper
either browses the widget by hand or lets the assistant browse for them.

## Context

Until v0.6.0 the store's `/mcp` answered every UCP tool with the UCP body in `structuredContent`
and the same body as text; a host showed it as text. Hosts now render HTML views that an MCP
server declares: the open MCP Apps standard (`_meta.ui.resourceUri`, resources of type
`text/html;profile=mcp-app`, a `postMessage` JSON-RPC bridge), which ChatGPT implements, with its
older `openai/*` keys and `window.openai` kept as aliases. OpenAI's pages (read 2026-11-18) also say
that commerce plugins are approved for physical goods, that a saved payment method may be used but
the widget never collects new card details, and that a ZIP holding app references or lifecycle
hooks cannot be submitted. The owner asked for a product carousel and a bag that pays with a saved
card, two modes, and a plugin that can be downloaded from the site.

## Decision

1. **The UI dresses the UCP tools; it adds no commerce tool.** `search_catalog` and `get_product`
   name the carousel; the cart and checkout tools name the bag. Results stay the UCP body.
   Clients that render no UI (PAP agents, REST, text-only MCP hosts) see the same store.
2. **A widget holds no authority.** It has no token and no card data. Every action is the host's
   `tools/call` on the shopper's grant, and the server decides as before: scopes, the budget, the
   saved-card alias, idempotency. A tap in a widget proves no human presence, so it never raises a
   limit: over the budget the answer is `requires_escalation`, and the widget opens `continue_url`
   or `manage_url` on this site, where the shopper confirms with a password or a passkey.
3. **Two modes.** "By hand": the buttons call the tools themselves. "With the assistant": the same
   buttons send the assistant a sentence ("Add the Trench coat in Sand, size M, to my bag") and the
   assistant calls the tools; the widget then shows each new answer.
4. **Standard first.** The widget speaks the MCP Apps bridge and falls back to `window.openai` when
   the host offers only that. Both are written here, about a hundred lines, with no new dependency.
5. **Payments ask first.** `complete_checkout` is annotated destructive and open-world, the cancel
   tools destructive, so hosts ask the shopper before running them. This applies to every client.
6. **The store's own name.** The widgets and the plugin carry Atelier Velune's name and art only.
7. **The plugin package** holds `plugin.json`, `mcp.json` (this site's `/mcp`), a personal-stylist
   skill and icons, and no app reference or hook. It is a download and a dashboard upload; ChatGPT
   on a phone connects by the MCP address. Publishing to the public directory is not decided.

## Consequences

- One more surface to keep: the bridge, two widgets and their build. `scripts/build-widgets.ts`
  writes `src/server/widgets.gen.ts` with its sources' hash, and a test fails when they differ.
- The widget runs on the host's sandbox origin. Its CSP allows images from this site only and no
  connection; everything goes through the host.
- Hosts that honour the annotations ask before each payment, so an agent paying on its own, within
  the budget, now meets a confirmation it did not meet before.

## Revisit when

- ChatGPT's embedded checkout (`requestCheckout`) leaves private beta, or the owner wants the
  plugin in the public directory (domain challenge, policies, review cases, demo recording).
- MCP Apps changes its bridge or resource type.

---
type: Decision
title: "ADR-019: Flagship storefront, a 30-piece catalogue with an OpenAI product feed, GSAP motion and an inline Personal Shopper"
description: "Owner, 2026-11-27: the agentic store becomes a flagship storefront: 30 products with product feed data, GSAP motion, a unified checkout and the Ask agent as Personal Shopper, synced with the site session."
tags: [decision, agentic, storefront, catalog, feed, gsap, ask]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-11-26T23:40:00Z
sources:
  - id: spec
    resource: ../components/agentic-storefront.md
    title: The flagship storefront's spec
  - id: store
    resource: ../components/adyen-agentic-commerce.md
    title: The store's spec (UCP, MCP, PAP, accounts, checkout)
  - id: ask
    resource: ../components/ask-agent.md
    title: The Ask agent's spec
  - id: openai-feed
    resource: https://developers.openai.com/commerce/specs/feed
    title: "OpenAI: product feed schema (read 2026-11-27)"
  - id: gsap
    resource: https://gsap.com/licensing/
    title: "GSAP: free standard licence, plugins included"
---

# ADR-019: Flagship storefront, product feed, GSAP motion, inline Personal Shopper

**Status.** Accepted by the owner on 2026-11-27, in chat ("implement all of this"), on a six-slice
plan that names the install of `gsap` 3.15.1 and `@gsap/react` 2.1.2.

## Context

The store read as a developer demo: a hero about `/mcp`, Docs and Back Office in the header, 13
products with one-line descriptions, a chat called "Ask" that asked a signed-in shopper to sign in
again, a cart that prefilled a demo email and a checkout that hid payment behind a separate email
step. Agents and humans shop the same catalogue, so richer product data serves both.

## Decision

1. **Catalogue:** 30 products in five categories (clothing, footwear, bags, accessories,
   essentials). The 13 earlier ids and variants never change. Each product carries the fields the
   OpenAI product feed takes (material, gender, weight, parcel dimensions, highlights, care, fit,
   origin, demo rating), and a markdown keeps the paid price in `price` with `compareAt` before it.
2. **Pictures:** the agent cannot make photographs, so the original SVG drawings stay and grow to
   the new shapes; a photo can later replace a drawing without changing any id.
3. **Feed:** the store publishes its catalogue as an OpenAI product feed in JSON and JSONL, with the
   field names the spec calls current (`group_id`, `url`, `is_eligible_search`).
4. **Motion:** GSAP with `@gsap/react` for page motion, off under `prefers-reduced-motion`.
5. **Personal Shopper:** the Ask agent's visible name; it follows the site session at once, never
   asks a signed-in shopper to sign in or for an email, and may take a spend limit in one click
   for the signed-in account (a real grant, revocable on the account page).

## Consequences

- Category filters (MCP, UCP REST, WebMCP) accept five categories; tests that counted 13 products
  now count the catalogue.
- Two client dependencies more, pinned exactly.
- An SVG picture is not a JPEG or PNG, which the feed spec names as examples: a feed consumer may
  skip the image until photographs exist.

---
type: Component
title: "The other playgrounds: styling, endless aisle, agentic commerce, landing"
description: "One paragraph each on the three playgrounds outside the current focus and the static landing page: what they do, their status, and where their own README is."
tags: [component, styling, ipp, agentic, landing]
status: stable
scope: component-other-playgrounds
generated:
  by: claude-code/opus-5.5
  at: 2026-10-09T19:30:00Z
sources:
  - id: readme
    resource: README.md
    title: Application table and statuses
  - id: styling
    resource: apps/adyen-v6-styling/README.md
    title: Drop-in Styling
  - id: ipp
    resource: apps/adyen-ipp-endless-aisle/README.md
    title: Endless Aisle
  - id: agentic
    resource: apps/adyen-agentic-commerce/README.md
    title: Agentic Commerce
---

# The other playgrounds

- **`adyen-v6-styling` (Drop-in Styling, Ready, port 8004).** A theming workbench: secured-field
  `styles`, Card and Drop-in options, and every `--adyen-sdk-*` token Adyen Web reads, with export.
  It creates a session and mounts a Drop-in; it stores nothing but panel settings in `localStorage`.
  Its token audit (`components/adyenOptions.test.ts`) fetches the real `adyen.css` for the pinned
  version and fails on drift, so an Adyen Web bump has to be looked at. It does not use the dev
  bundle plugin yet, so in dev it has the same ad-blocker exposure digital had.
  [README](../../apps/adyen-v6-styling/README.md).
- **`adyen-ipp-endless-aisle` (in progress, port 8002).** In-person cart paid on a TEST terminal
  through Terminal API Cloud (device API). Mock mode calls Adyen not at all.
  [README](../../apps/adyen-ipp-endless-aisle/README.md).
- **`adyen-agentic-commerce` (in progress, port 8003).** Agent-initiated purchase over a delegated
  token. Mock mode is a local simulation; real mode answers `501` because no public TEST contract
  exists. The human-confirmed payment is a standard Checkout session.
  [README](../../apps/adyen-agentic-commerce/README.md).
- **`apps/landing`.** Plain HTML and CSS, no build, no server, deployed as a Render static site. It
  links to the four playgrounds; no playground links back to it.

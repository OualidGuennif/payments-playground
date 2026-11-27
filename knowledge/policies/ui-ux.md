---
type: Policy
title: "UI and UX"
description: "Sober interfaces: tokens in one file with light and dark sets, AA contrast, phone first, shared blocks, unknown never reads as fine, a visual yes before shipping."
status: stable
generated:
  by: aeion-factory/1.0
  at: 2026-11-28T09:00:00Z
sources:
  - resource: ../../packages/ui/theme.ts
    title: "The theme tokens"
  - resource: ../../packages/ui/styles.css
    title: "The shared light and dark token sets, and the page width tokens"
  - resource: https://developer.apple.com/design/human-interface-guidelines/design-principles
    title: "Apple HIG, design principles: familiarity, flexibility, simplicity (read 2026-11-27)"
  - resource: https://developer.apple.com/design/human-interface-guidelines/layout
    title: "Apple HIG, layout: align, group with space, backgrounds fill the window (read 2026-11-27)"
  - resource: https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html
    title: "WCAG 2.2 SC 1.4.8 Visual Presentation: lines of at most 80 characters"
---

# UI and UX

Sober and exact rather than decorative.

## Tokens

- Every colour, radius, font size and spacing value is a token in one file, with a light and a dark
  set (system preference and an explicit choice). A hard-coded colour is a dark-mode bug.
- Text meets WCAG AA (4.5:1). One primary colour and one accent; amber and red only for meaning.
- A spacing scale (for example 4, 8, 12, 16, 20, 28, 44 px) and a type scale; tabular figures for
  amounts and times.

## Layout and behaviour

- Phone first: every changed screen checked at 375 px and 1440 px, light and dark. Tables stack into
  cards on small screens; touch targets are at least 44 px; a bottom tab bar on phones when there
  are a few destinations.
- Page width (owner, 2026-11-27): on a wide window the content stays in one centred column, so the
  eye does not cross a 15-inch laptop from edge to edge. The tokens: `--page-max` 1140 px for a
  page, `--page-max-wide` 1240 px for two columns that need it (a checkout beside its inspector, the
  store's header row), `--page-max-workbench` 1440 px for the Styling workbench, side margins
  `--page-gutter` `clamp(16px, 4vw, 48px)` and `--measure` 68ch for running text (WCAG 1.4.8 asks
  for at most 80 characters). They live in `packages/ui/styles.css`, and with the same values in
  the store's own `globals.css`. A page and its footer share the column's edges; backgrounds still
  fill the window (Apple HIG, Layout). Changed screens are also checked at 1710 px, a 15-inch
  MacBook Air set to More Space.
- Shared building blocks before new components: page header, section, stat, meter, list, card.
- No inline styles (a strict content security policy will drop them).
- Motion only to show a change of state (140–220 ms), none under reduced motion.
- A plain wordmark; no ornament that carries no information; no caption that says nothing.

## Truthfulness

- An unknown or missing value reads "unknown", never "fine"; a blank is not zero.
- A visual change gets a human's visual yes before it ships.

---
type: Decision
title: "ADR-010: Dark mode is one data-theme attribute over two token sets"
description: "An inline script sets data-theme on <html> before paint; every colour is a token defined for light and dark; digital's checkout follows the theme, styling's Drop-in never does."
tags: [decision, ui, theme, dark-mode]
status: stable
generated:
  by: claude-code/opus-5.5
  at: 2026-10-10T09:10:00Z
sources:
  - id: theme
    resource: packages/ui/theme.ts
    title: THEME_SCRIPT, currentTheme, the storage key and change event
  - id: tokens
    resource: packages/ui/styles.css
    title: Light and dark token sets
  - id: shell
    resource: packages/ui/components.tsx
    title: ThemeScript, ThemeToggle, TestPill, AppShell
  - id: workbench
    resource: apps/adyen-digital/islands/FlowWorkbench.tsx
    title: securedFieldStyles and the theme-driven remount
---

# ADR-010: Dark mode is one data-theme attribute over two token sets

**Context.** The owner asked for a dark mode in digital and styling, switched by a sliding toggle
that is easy to find on a phone (2026-10-09). Colours were partly hard-coded, digital, IPP and
agentic share `AppShell`, styling's preview must keep showing the merchant's configured look, and
Adyen's secured-field iframes take their colours only when they mount.

**Decision.**

- `THEME_SCRIPT` runs inline in every `_app.tsx` `<head>`: it sets `data-theme` on `<html>` from the
  stored choice (`localStorage` `playground-theme`) or `prefers-color-scheme`, so the first paint is
  already in the right theme. The same script handles the toggle by event delegation, so it works
  before islands hydrate, and announces changes with `playground-themechange`.
- `packages/ui/styles.css` defines every colour as a token in a light set (`:root`) and a dark set
  (`:root[data-theme="dark"]`). Light values are the ones the playground had before.
- Digital's checkout follows the theme: dark `--adyen-sdk-*` tokens on `.checkout-pay`,
  secured-field `styles` from `securedFieldStyles(theme)`, and a remount when the theme changes.
- Styling's Drop-in column opts out with `.keep-light` (the light token set) and
  `color-scheme:
  light`: the checkout and the export look the same in both themes. Everything
  around it is the tool's and goes dark: toolbar, test data, options panel and the canvas, which
  only shows the merchant's `background-secondary` in light mode. The first version kept the whole
  canvas light, which on a phone left a dark toolbar over a white page (owner, 2026-10-10).
- The full-width TEST banner became a permanent TEST pill, visible on mobile too: in the header
  (IPP, agentic), in the footer on digital and styling, whose headers keep only navigation or
  preview controls, the theme switch and settings (owner, 2026-10-10).

**Consequences.** A new colour means a token in both sets; a hard-coded colour is a bug in dark
mode. Toggling the theme on a checkout remounts it, which for Sessions creates a new order. IPP and
agentic get the dark shell for free; their app-specific CSS was not reworked for it.

// Spec: knowledge/components/ui-package.md
// A server component on purpose: each app's root layout renders it in <head>, so the theme is set
// from the HTML before first paint and React never has to run it on the client.
import { THEME_SCRIPT } from "./theme.ts";

/** Inline in every app's <head>, before any stylesheet paints. */
export function ThemeScript() {
  // A constant written in this repo, never user input. As a text child it
  // would be HTML-escaped by the server renderer and stop being JavaScript.
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

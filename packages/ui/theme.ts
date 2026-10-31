// Spec: knowledge/components/ui-package.md
/**
 * Light/dark theme, shared by every app.
 *
 * THEME_SCRIPT is inlined in each app's <head> so the theme is set before
 * first paint (no light flash on a dark visit). It stores the choice per
 * browser, falls back to the system preference, and handles every
 * [data-theme-toggle] by event delegation: no island, so the same switch works
 * in server-rendered headers and inside islands alike. Islands that must
 * react (a Drop-in restyled for dark) listen for THEME_CHANGE_EVENT.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "playground-theme";
export const THEME_CHANGE_EVENT = "playground-themechange";

const THEME_COLOR = { light: "#ffffff", dark: "#0c0e12" };

export const THEME_SCRIPT = `(function () {
  var root = document.documentElement;
  function stored() {
    try { return localStorage.getItem("${THEME_STORAGE_KEY}"); } catch (error) { return null; }
  }
  function system() {
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "${THEME_COLOR.dark}" : "${THEME_COLOR.light}");
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute("aria-checked", theme === "dark" ? "true" : "false");
    }
  }
  function announce(theme) {
    window.dispatchEvent(new CustomEvent("${THEME_CHANGE_EVENT}", { detail: theme }));
  }
  var saved = stored();
  apply(saved === "dark" || saved === "light" ? saved : system());
  document.addEventListener("DOMContentLoaded", function () { apply(root.getAttribute("data-theme")); });
  document.addEventListener("click", function (event) {
    var toggle = event.target && event.target.closest && event.target.closest("[data-theme-toggle]");
    if (!toggle) return;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem("${THEME_STORAGE_KEY}", next); } catch (error) {}
    apply(next);
    announce(next);
  });
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (event) {
      if (stored()) return;
      var next = event.matches ? "dark" : "light";
      apply(next);
      announce(next);
    });
  }
})();`;

/** The theme the page is showing; "light" during SSR. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Spec: knowledge/components/agentic-storefront.md
// The saved theme's key, and the head script that applies it before the first paint, so a saved
// theme never flashes the other one. Plain module: the server layout reads the script.
export const THEME_KEY = "velune-theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export type Theme = "light" | "dark";

// In the browser only: the header's choice (data-theme on <html>), else the system's.
export function resolvedTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Calls back when either can change the theme: the header's switch sets data-theme without a
// reload, and the system's setting applies while the switch says "system". Returns the stop.
export function onThemeChange(listener: () => void): () => void {
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const chosen = new MutationObserver(listener);
  chosen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  scheme.addEventListener("change", listener);
  return () => {
    chosen.disconnect();
    scheme.removeEventListener("change", listener);
  };
}

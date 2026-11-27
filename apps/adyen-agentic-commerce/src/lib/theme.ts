// Spec: knowledge/components/agentic-storefront.md
// The saved theme's key, and the head script that applies it before the first paint, so a saved
// theme never flashes the other one. Plain module: the server layout reads the script.
export const THEME_KEY = "velune-theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

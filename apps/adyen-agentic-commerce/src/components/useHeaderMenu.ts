"use client";
// Spec: knowledge/components/agentic-storefront.md
// The header's menus and the Personal Shopper never cover each other (Layers): opening the
// Personal Shopper closes the menus, and opening a menu under 1024 px minimises an open one.
import { type RefObject, useEffect } from "react";
import { askState, setAskState } from "@/components/ask/askClient";

export const CLOSE_MENUS = "velune:close-menus";
const DOCKS = "(min-width: 1024px)";

export const closeHeaderMenus = () => window.dispatchEvent(new Event(CLOSE_MENUS));

/** `shownKey` changes when the menu's element first appears (the account menu waits for the session). */
export function useHeaderMenu(menu: RefObject<HTMLDetailsElement | null>, shownKey?: unknown) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the element appears with shownKey
  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const close = () => {
      el.open = false;
    };
    const toggled = () => {
      if (el.open && !window.matchMedia(DOCKS).matches && askState() === "open")
        setAskState("minimised");
    };
    window.addEventListener(CLOSE_MENUS, close);
    el.addEventListener("toggle", toggled);
    return () => {
      window.removeEventListener(CLOSE_MENUS, close);
      el.removeEventListener("toggle", toggled);
    };
  }, [menu, shownKey]);
}

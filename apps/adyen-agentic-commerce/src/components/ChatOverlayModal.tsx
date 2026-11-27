// Spec: knowledge/components/agentic-storefront.md
"use client";
// The one overlay the store's modals share, on a page or above the Personal Shopper (ADR-021): a
// centred card from 640 px; below, a card held to the top of the visual viewport, which it follows,
// so the iOS keyboard and its toolbar never cover a field or its button. Focus stays inside, goes
// back where it was on close, and lands on a field by itself only with a fine pointer: on a phone
// that would open the keyboard before the shopper has read the card.
import { type ReactNode, useEffect, useId, useRef } from "react";

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]):not([hidden]), select:not([disabled]), textarea:not([disabled]), iframe";

const finePointer = () => window.matchMedia("(pointer: fine)").matches;

function focusStart(box: HTMLElement) {
  const field = finePointer() ? box.querySelector<HTMLElement>("[data-autofocus]") : null;
  (field ?? box).focus({ preventScroll: true });
}

export function ChatOverlayModal({
  title,
  onClose,
  busy = false,
  focusKey,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  // While busy, Escape, the backdrop and the close button wait for the answer.
  busy?: boolean;
  // A new value (a new step) starts focus again on its first field.
  focusKey?: unknown;
  children: ReactNode;
}) {
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  // The page behind stays still; focus goes back where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add("overflow-hidden");
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  // iOS keeps the layout viewport when its keyboard opens and moves the visual one: the card
  // follows the visual viewport's top and height. Set through the CSSOM, never a style attribute.
  useEffect(() => {
    const target = frame.current;
    const viewport = window.visualViewport;
    if (!target || !viewport) return;
    const follow = () => {
      target.style.setProperty("--vv-top", `${Math.max(0, viewport.offsetTop)}px`);
      target.style.setProperty("--vv-height", `${viewport.height}px`);
    };
    follow();
    viewport.addEventListener("resize", follow);
    viewport.addEventListener("scroll", follow);
    return () => {
      viewport.removeEventListener("resize", follow);
      viewport.removeEventListener("scroll", follow);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each step draws new fields to focus
  useEffect(() => {
    if (dialog.current) focusStart(dialog.current);
  }, [focusKey]);

  // After a refusal (a wrong password, a cancelled passkey) focus comes back inside the card.
  useEffect(() => {
    const box = dialog.current;
    if (busy || !box || box.contains(document.activeElement)) return;
    focusStart(box);
  }, [busy]);

  // Keys are read on the document: a button disabled while busy drops focus to the page, and
  // Escape and Tab must still close the card or come back inside it.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const box = dialog.current;
      if (!box) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items.at(-1);
      const at = document.activeElement;
      const inside = at instanceof Node && box.contains(at) && at !== box;
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (!inside || (event.shiftKey && at === first) || (!event.shiftKey && at === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 z-[60] cursor-default bg-scrim/40"
        onClick={() => !busy && onClose()}
      />
      <div
        ref={frame}
        className="pointer-events-none fixed inset-x-0 top-[var(--vv-top,0px)] z-[60] flex h-[var(--vv-height,100dvh)] items-start justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:items-center sm:p-6"
      >
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="velune-glass-card pointer-events-auto max-h-full w-full space-y-4 overflow-y-auto overscroll-contain rounded-3xl border border-line p-5 text-ink shadow-xl outline-none sm:max-w-md sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-2xl">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="btn-ghost size-11 min-h-11 shrink-0 p-0"
              disabled={busy}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

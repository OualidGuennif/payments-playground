"use client";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/**
 * A modal panel: from the right on a desktop, from the bottom on a phone.
 * Escape, the backdrop and the close button all dismiss it; the page behind
 * does not scroll while it is open.
 */
export function Sheet(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent passes a new onClose each render; re-running would refocus the panel.
  useEffect(() => {
    if (!props.open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div className="sheet" role="presentation">
      <button
        type="button"
        className="sheet__backdrop"
        aria-label="Close"
        tabIndex={-1}
        onClick={props.onClose}
      />
      <div
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        ref={panel}
      >
        <span className="sheet__grip" aria-hidden="true" />
        <header className="sheet__header">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={props.onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="sheet__body">{props.children}</div>
        {props.footer ? <footer className="sheet__footer">{props.footer}</footer> : null}
      </div>
    </div>
  );
}

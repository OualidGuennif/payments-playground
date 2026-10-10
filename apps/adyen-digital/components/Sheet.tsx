import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

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
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);

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
    <div class="sheet" role="presentation">
      <button
        type="button"
        class="sheet__backdrop"
        aria-label="Close"
        tabindex={-1}
        onClick={props.onClose}
      />
      <div
        class="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabindex={-1}
        ref={panel}
      >
        <span class="sheet__grip" aria-hidden="true" />
        <header class="sheet__header">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          <button type="button" class="icon-button" aria-label="Close" onClick={props.onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>
        <div class="sheet__body">{props.children}</div>
        {props.footer ? <footer class="sheet__footer">{props.footer}</footer> : null}
      </div>
    </div>
  );
}

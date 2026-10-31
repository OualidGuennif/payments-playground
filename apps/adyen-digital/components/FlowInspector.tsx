// Spec: knowledge/components/adyen-digital.md
import { useCopy } from "@suite/ui/useCopy.ts";
import { Timeline, type TimelineEntry } from "./Timeline.tsx";

/**
 * The side panel: the run's progress, every event as it lands, and the
 * correlation id to carry into the Back Office. Mounted only while open.
 */
export function FlowInspector(props: {
  entries: TimelineEntry[];
  steps: Array<[string, boolean]>;
  correlationId: string | null;
  /** The scroll container, owned by the island so its follow state survives a reopen. */
  body: { current: HTMLDivElement | null };
  follow: { current: boolean };
  onClose: () => void;
}) {
  const { entries, steps, correlationId, body, follow, onClose } = props;
  const { copied, copy } = useCopy();
  return (
    <aside class="inspector-panel" aria-label="Inspector">
      <header class="inspector-panel__head">
        <h2>
          Inspector
          <span class="live" title="Refreshed every few seconds">Live</span>
        </h2>
        <button
          type="button"
          class="icon-button"
          aria-label="Close the inspector"
          onClick={onClose}
        >
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
      <ol class="steps" aria-label="Progress">
        {steps.map(([label, done]) => (
          <li key={label} class={done ? "is-done" : undefined}>{label}</li>
        ))}
      </ol>
      <div
        class="inspector-panel__body"
        ref={body}
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        <Timeline
          entries={entries}
          empty="Events land here as the checkout runs: Adyen Web callbacks, the API calls this server makes, and the webhooks Adyen sends back."
        />
      </div>
      {correlationId
        ? (
          <footer class="inspector-panel__foot">
            <span>Correlation</span>
            <button
              type="button"
              class="text-button mono"
              onClick={() => copy(correlationId)}
            >
              {copied === correlationId ? "Copied" : correlationId}
            </button>
          </footer>
        )
        : null}
    </aside>
  );
}

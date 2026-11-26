// Spec: knowledge/components/ask-agent.md
// The panel's line icons: decorative unless a label makes them the control's name.
export const Icon = ({ d, label }: { d: string; label?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={label ? undefined : true}
    role={label ? "img" : undefined}
    aria-label={label}
  >
    <path d={d} />
  </svg>
);

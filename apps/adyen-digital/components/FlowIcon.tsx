/** One line icon per flow, for the checkout's flow badge. */
const PATHS: Record<string, string> = {
  sessions: "M4 7h16v10H4zM4 10h16",
  advanced: "M5 6h14v4H5zM5 14h14v4H5zM8 8h.01M8 16h.01",
  "api-only": "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  "pay-by-link":
    "M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3",
  mit: "M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4",
};

export function FlowIcon(props: { name: string; class: string; size?: number }) {
  const size = props.size ?? 22;
  return (
    <span class={props.class} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <path
          d={PATHS[props.name]}
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

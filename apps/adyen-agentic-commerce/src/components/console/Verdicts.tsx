// Spec: knowledge/components/ask-agent.md
// One message's stage verdicts as pills: green when the stage let it through.
import { passing, type Verdict } from "./consoleApi";

export function Verdicts({ verdicts }: { verdicts?: Verdict[] }) {
  if (!verdicts?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Stage verdicts">
      {verdicts.map((v, i) => (
        <li
          // Verdicts of one message never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: a stage may appear twice in one message.
          key={i}
          title={v.detail}
          className={`pill ${passing(v) ? "border-ok text-ok" : "border-bad text-bad"}`}
        >
          {v.stage}: {v.result}
          {v.scoreDelta ? ` (${v.scoreDelta > 0 ? "+" : ""}${v.scoreDelta})` : ""}
        </li>
      ))}
    </ul>
  );
}

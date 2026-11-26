// Spec: knowledge/components/adyen-agentic-commerce.md
// The plain-words frame around every Docs diagram: what it is for before, what to keep after.
import { HOW_TO_READ } from "./plain";
import { Rich } from "./Rich";

export function PlainWords({ paragraphs }: { paragraphs: string[] }) {
  return (
    <section className="panel max-w-[72ch] space-y-2">
      <h2 className="text-lg">In plain words</h2>
      {paragraphs.map((p) => (
        <p key={p.slice(0, 40)} className="text-sm leading-relaxed">
          <Rich text={p} />
        </p>
      ))}
      <p className="border-t border-line pt-2 text-xs text-muted">
        <span className="font-medium">How to read the diagram: </span>
        {HOW_TO_READ}
      </p>
    </section>
  );
}

export function Remember({ items }: { items: string[] }) {
  return (
    <section className="panel space-y-2">
      <h2 className="text-lg">What to remember</h2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        {items.map((item) => (
          <li key={item.slice(0, 40)}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

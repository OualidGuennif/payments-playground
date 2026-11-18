// Spec: knowledge/components/adyen-agentic-commerce.md
import { Fragment } from "react";

// Docs text keeps endpoint and field names between backticks; they render as code.
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string, in order.
          <span key={i} className="code break-words">
            {part}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string, in order.
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

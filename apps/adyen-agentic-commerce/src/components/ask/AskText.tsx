"use client";
// Spec: knowledge/components/ask-agent.md
// An answer's light Markdown, drawn from parsed data. A link to this store opens in place, so the
// panel stays open; any other http(s) link opens in a new tab without the opener.
import Link from "next/link";
import { blocks, type Inline } from "./askLogic";

function localPath(href: string): string | undefined {
  if (href.startsWith("/")) return href;
  try {
    const url = new URL(href);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}

function Run({ part }: { part: Inline }) {
  if (part.kind === "strong") return <strong className="font-semibold">{part.text}</strong>;
  if (part.kind === "em") return <em>{part.text}</em>;
  if (part.kind === "code") return <code className="code">{part.text}</code>;
  if (part.kind === "link") {
    const local = localPath(part.href);
    return local ? (
      <Link href={local} className="font-medium text-accent underline">
        {part.text}
      </Link>
    ) : (
      <a
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent underline"
      >
        {part.text}
      </a>
    );
  }
  return <>{part.text}</>;
}

const runs = (parts: Inline[]) => parts.map((part) => <Run key={part.at} part={part} />);

export function AskText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {blocks(text).map((block) => {
        if (block.kind === "h")
          return (
            <p key={block.at} className="font-semibold">
              {runs(block.inline)}
            </p>
          );
        if (block.kind === "p")
          return (
            <p key={block.at} className="whitespace-pre-line">
              {runs(block.inline)}
            </p>
          );
        const List = block.kind;
        return (
          <List
            key={block.at}
            className={`space-y-1 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}
          >
            {block.items.map((item) => (
              <li key={item.at}>{runs(item.inline)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
